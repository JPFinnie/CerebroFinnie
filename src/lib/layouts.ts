import type { LayoutNode, LayoutResult, TopologyMode, VaultGraph, VaultNote } from '../types';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

type SpatialPoint = {
  x: number;
  y: number;
  z: number;
};

type ForcePoint = SpatialPoint & {
  vx: number;
  vy: number;
  vz: number;
};

type GroupLayoutStats = {
  crossLinks: number;
  internalLinks: number;
  totalImportance: number;
  size: number;
};

export function buildTopologyLayout(graph: VaultGraph, topology: TopologyMode): LayoutResult {
  const notes = graph.notes;
  if (notes.length === 0) {
    return {
      nodes: [],
      nodeMap: new Map(),
      radius: 8,
      hubNoteId: null,
      center: [0, 0, 0],
    };
  }

  const maxImportance = Math.max(...notes.map((note) => note.importance), 1);
  const hubNoteId = notes[0]?.id ?? null;

  const rawSpatialPoints =
    topology === 'centralized'
      ? buildCentralizedLayout(graph, hubNoteId)
      : topology === 'clustered'
        ? buildClusteredLayout(graph)
        : buildDistributedLayout(graph);

  const spatialPoints = normalizeSpatialPoints(rawSpatialPoints, getTargetRadius(topology));

  const preliminaryNodes: LayoutNode[] = notes.map((note) => {
    const point = spatialPoints.get(note.id) ?? { x: 0, y: 0, z: 0 };
    const importanceRatio = note.importance / maxImportance;
    const scale = 0.28 + Math.pow(importanceRatio, 1.03) * 0.68;
    const buoyancy = (importanceRatio - 0.5) * 0.8;

    return {
      ...note,
      position: [point.x, point.y + buoyancy, point.z],
      scale,
    };
  });

  const center = calculateCenter(preliminaryNodes);
  const radius = Math.max(
    8,
    ...preliminaryNodes.map((node) => {
      return Math.hypot(
        node.position[0] - center[0],
        node.position[1] - center[1],
        node.position[2] - center[2],
      );
    }),
  );

  return {
    nodes: preliminaryNodes,
    nodeMap: new Map(preliminaryNodes.map((node) => [node.id, node])),
    radius,
    hubNoteId,
    center,
  };
}

function buildCentralizedLayout(graph: VaultGraph, hubNoteId: string | null) {
  const positions = new Map<string, SpatialPoint>();
  if (!hubNoteId) {
    return positions;
  }

  const distances = getUndirectedDistances(graph, hubNoteId);
  const buckets = new Map<number, VaultNote[]>();

  for (const note of graph.notes) {
    if (note.id === hubNoteId) {
      positions.set(note.id, { x: 0, y: 0, z: 0 });
      continue;
    }

    const rawDistance = distances.get(note.id);
    const distance = Number.isFinite(rawDistance) ? (rawDistance ?? 5) : 5;
    const bucket = buckets.get(distance);
    if (bucket) {
      bucket.push(note);
    } else {
      buckets.set(distance, [note]);
    }
  }

  for (const [distance, notes] of Array.from(buckets.entries()).sort((left, right) => left[0] - right[0])) {
    const orbitRadius = 2.8 + distance * 1.85;
    const sortedNotes = [...notes].sort(
      (left, right) => right.importance - left.importance || left.title.localeCompare(right.title),
    );

    sortedNotes.forEach((note, index) => {
      const azimuth = (index / sortedNotes.length) * TAU + seeded(note.id, 'central-angle') * 0.9;
      const latitude = (seeded(note.id, 'central-latitude') - 0.5) * 1.35 + Math.sin(index * 0.85) * 0.12;
      const spread = orbitRadius * Math.sqrt(Math.max(0.22, 1 - latitude * latitude * 0.6));

      positions.set(note.id, {
        x: Math.cos(azimuth) * spread,
        y: latitude * orbitRadius * 0.92,
        z: Math.sin(azimuth) * spread,
      });
    });
  }

  return positions;
}

function buildClusteredLayout(graph: VaultGraph) {
  const positions = new Map<string, SpatialPoint>();
  const noteGroupMap = new Map(graph.notes.map((note) => [note.id, note.group]));
  const groupStats = buildGroupLayoutStats(graph, noteGroupMap);
  const groupedNotes = Array.from(groupBy(graph.notes, (note) => note.group).entries())
    .map(([group, notes]) => ({
      group,
      notes: [...notes].sort(
        (left, right) => right.importance - left.importance || left.title.localeCompare(right.title),
      ),
      stats:
        groupStats.get(group) ?? {
          crossLinks: 0,
          internalLinks: 0,
          totalImportance: notes.reduce((sum, note) => sum + note.importance, 0),
          size: notes.length,
        },
    }))
    .sort((left, right) => {
      return (
        right.notes.length - left.notes.length ||
        right.stats.crossLinks - left.stats.crossLinks ||
        left.group.localeCompare(right.group)
      );
    });

  groupedNotes.forEach(({ group, notes, stats }, groupIndex) => {
    if (groupedNotes.length === 1) {
      notes.forEach((note, noteIndex) => {
        if (noteIndex === 0) {
          positions.set(note.id, { x: 0, y: 0, z: 0 });
          return;
        }

        const localIndex = noteIndex - 1;
        const spiralRadius = 1.7 + Math.sqrt(localIndex + 1) * 0.92;
        const angle = localIndex * GOLDEN_ANGLE + seeded(note.id, 'solo-cluster-angle') * 0.8;
        const depth = (seeded(note.id, 'solo-cluster-depth') - 0.5) * 2.1;

        positions.set(note.id, {
          x: Math.cos(angle) * spiralRadius,
          y: depth,
          z: Math.sin(angle) * spiralRadius,
        });
      });
      return;
    }

    const direction = getFibonacciSpherePoint(groupIndex, groupedNotes.length, seeded(group, 'cluster-jitter'));
    const connectivityRatio = stats.crossLinks / Math.max(1, stats.crossLinks + stats.internalLinks);
    const importanceRatio = stats.totalImportance / Math.max(1, notes.length * Math.max(notes[0]?.importance ?? 1, 1));
    const shellRadius =
      7.4 +
      (1 - connectivityRatio) * 2.6 +
      Math.min(1.8, Math.log2(notes.length + 1) * 0.55) +
      Math.min(1.1, importanceRatio * 0.18) +
      seeded(group, 'cluster-shell') * 1.2;
    const clusterCenter = scalePoint(direction, shellRadius);
    const clusterRadius =
      1.9 + Math.cbrt(notes.length) * 1.2 + Math.min(1.2, stats.crossLinks * 0.03) + seeded(group, 'cluster-span') * 0.5;
    const { tangent, bitangent } = getPerpendicularBasis(direction);

    notes.forEach((note, noteIndex) => {
      if (noteIndex === 0) {
        const inwardBias = clusterRadius * 0.24;
        positions.set(note.id, {
          x: clusterCenter.x - direction.x * inwardBias,
          y: clusterCenter.y - direction.y * inwardBias,
          z: clusterCenter.z - direction.z * inwardBias,
        });
        return;
      }

      const localIndex = noteIndex - 1;
      const localProgress = Math.sqrt((localIndex + 0.75) / Math.max(1, notes.length - 0.15));
      const localRadius =
        clusterRadius *
        localProgress *
        (0.82 + seeded(note.id, 'cluster-local-radius') * 0.5);
      const angle = localIndex * GOLDEN_ANGLE + seeded(`${group}:${note.id}`, 'cluster-local-angle') * 0.9;
      const axial =
        (seeded(note.id, 'cluster-depth') - 0.5) * clusterRadius * 1.15 +
        Math.sin(localIndex * 0.72) * clusterRadius * 0.12;
      const tangential = Math.cos(angle) * localRadius;
      const binormal = Math.sin(angle) * localRadius;

      positions.set(note.id, {
        x:
          clusterCenter.x +
          tangent.x * tangential +
          bitangent.x * binormal +
          direction.x * axial,
        y:
          clusterCenter.y +
          tangent.y * tangential +
          bitangent.y * binormal +
          direction.y * axial,
        z:
          clusterCenter.z +
          tangent.z * tangential +
          bitangent.z * binormal +
          direction.z * axial,
      });
    });
  });

  return positions;
}

function buildDistributedLayout(graph: VaultGraph) {
  const notes = graph.notes;
  const indexMap = new Map(notes.map((note, index) => [note.id, index]));
  const positions: ForcePoint[] = notes.map((note, index) => {
    const azimuth = seeded(note.id, `distributed-angle-${index}`) * TAU;
    const pitch = (seeded(note.id, `distributed-pitch-${index}`) - 0.5) * Math.PI * 0.78;
    const radius = 5.1 + seeded(note.id, `distributed-radius-${index}`) * 13.8;
    const planar = Math.cos(pitch) * radius;

    return {
      x: Math.cos(azimuth) * planar,
      y: Math.sin(pitch) * radius * 0.92,
      z: Math.sin(azimuth) * planar,
      vx: 0,
      vy: 0,
      vz: 0,
    };
  });

  const links = graph.edges
    .map((edge) => {
      const source = indexMap.get(edge.source);
      const target = indexMap.get(edge.target);

      if (source === undefined || target === undefined) {
        return null;
      }

      const restLength =
        edge.kind === 'sibling' ? 7.2 : edge.kind === 'semantic' ? 5.8 : 5.3;
      const strength =
        edge.kind === 'sibling'
          ? 0.006
          : edge.kind === 'semantic'
            ? 0.014
            : 0.017;

      return {
        source,
        target,
        restLength,
        strength: strength * Math.max(0.6, edge.weight),
      };
    })
    .filter(
      (
        value,
      ): value is { source: number; target: number; restLength: number; strength: number } => value !== null,
    );

  for (let iteration = 0; iteration < 190; iteration += 1) {
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const a = positions[left];
        const b = positions[right];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz + 0.34;
        const distance = Math.sqrt(distanceSquared);
        const repel = 8.4 / distanceSquared;
        const nx = dx / distance;
        const ny = dy / distance;
        const nz = dz / distance;

        a.vx += nx * repel;
        a.vy += ny * repel;
        a.vz += nz * repel;
        b.vx -= nx * repel;
        b.vy -= ny * repel;
        b.vz -= nz * repel;
      }
    }

    for (const link of links) {
      const source = positions[link.source];
      const target = positions[link.target];
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
      const spring = (distance - link.restLength) * link.strength;
      const nx = dx / distance;
      const ny = dy / distance;
      const nz = dz / distance;

      source.vx += nx * spring;
      source.vy += ny * spring;
      source.vz += nz * spring;
      target.vx -= nx * spring;
      target.vy -= ny * spring;
      target.vz -= nz * spring;
    }

    for (const point of positions) {
      point.vx += -point.x * 0.0046;
      point.vy += -point.y * 0.0049;
      point.vz += -point.z * 0.0046;
      point.vx *= 0.8;
      point.vy *= 0.8;
      point.vz *= 0.8;
      point.x += point.vx;
      point.y += point.vy;
      point.z += point.vz;
    }
  }

  return new Map(
    notes.map((note, index) => [
      note.id,
      {
        x: positions[index].x,
        y: positions[index].y,
        z: positions[index].z,
      },
    ]),
  );
}

function getTargetRadius(topology: TopologyMode) {
  switch (topology) {
    case 'centralized':
      return 12.2;
    case 'clustered':
      return 14.8;
    case 'distributed':
      return 13.8;
    default:
      return 13.8;
  }
}

function normalizeSpatialPoints(points: Map<string, SpatialPoint>, targetRadius: number) {
  if (points.size === 0) {
    return new Map<string, SpatialPoint>();
  }

  let centerX = 0;
  let centerY = 0;
  let centerZ = 0;

  for (const point of points.values()) {
    centerX += point.x;
    centerY += point.y;
    centerZ += point.z;
  }

  centerX /= points.size;
  centerY /= points.size;
  centerZ /= points.size;

  let furthest = 0;
  for (const point of points.values()) {
    furthest = Math.max(
      furthest,
      Math.hypot(point.x - centerX, point.y - centerY, point.z - centerZ),
    );
  }

  const scale = furthest > 0 ? targetRadius / furthest : 1;

  return new Map(
    Array.from(points.entries(), ([id, point]) => [
      id,
      {
        x: (point.x - centerX) * scale,
        y: (point.y - centerY) * scale,
        z: (point.z - centerZ) * scale,
      },
    ]),
  );
}

function calculateCenter(nodes: LayoutNode[]): [number, number, number] {
  if (nodes.length === 0) {
    return [0, 0, 0];
  }

  const totals = nodes.reduce(
    (accumulator, node) => {
      accumulator.x += node.position[0];
      accumulator.y += node.position[1];
      accumulator.z += node.position[2];
      return accumulator;
    },
    { x: 0, y: 0, z: 0 },
  );

  return [totals.x / nodes.length, totals.y / nodes.length, totals.z / nodes.length];
}

function getUndirectedDistances(graph: VaultGraph, startId: string) {
  const adjacency = new Map<string, Set<string>>();

  for (const note of graph.notes) {
    adjacency.set(note.id, new Set());
  }

  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const distances = new Map<string, number>([[startId, 0]]);
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const currentDistance = distances.get(current) ?? 0;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (distances.has(neighbor)) {
        continue;
      }

      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }

  return distances;
}

function groupBy<T>(items: T[], getKey: (value: T) => string) {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = getKey(item);
    const existing = groups.get(key);

    if (existing) {
      existing.push(item);
      continue;
    }

    groups.set(key, [item]);
  }

  return groups;
}

function buildGroupLayoutStats(graph: VaultGraph, noteGroupMap: Map<string, string>) {
  const stats = new Map<string, GroupLayoutStats>();

  for (const note of graph.notes) {
    const current =
      stats.get(note.group) ??
      {
        crossLinks: 0,
        internalLinks: 0,
        totalImportance: 0,
        size: 0,
      };

    current.size += 1;
    current.totalImportance += note.importance;
    stats.set(note.group, current);
  }

  for (const edge of graph.edges) {
    const sourceGroup = noteGroupMap.get(edge.source);
    const targetGroup = noteGroupMap.get(edge.target);
    if (!sourceGroup || !targetGroup) {
      continue;
    }

    const baseWeight =
      edge.kind === 'semantic' ? 1.1 : edge.kind === 'wikilink' ? 1 : 0.35;
    const contribution = Math.max(0.35, edge.weight) * baseWeight;

    if (sourceGroup === targetGroup) {
      const groupStats = stats.get(sourceGroup);
      if (groupStats) {
        groupStats.internalLinks += contribution;
      }
      continue;
    }

    const sourceStats = stats.get(sourceGroup);
    if (sourceStats) {
      sourceStats.crossLinks += contribution;
    }

    const targetStats = stats.get(targetGroup);
    if (targetStats) {
      targetStats.crossLinks += contribution;
    }
  }

  return stats;
}

function getFibonacciSpherePoint(index: number, count: number, jitter: number) {
  if (count <= 1) {
    return { x: 0, y: 1, z: 0 };
  }

  const offset = (index + 0.5 + jitter * 0.3) / count;
  const y = 1 - offset * 2;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * (index + jitter * 0.85);

  return normalizePoint({
    x: Math.cos(theta) * radial,
    y: y * 0.92,
    z: Math.sin(theta) * radial,
  });
}

function getPerpendicularBasis(direction: SpatialPoint) {
  const normalizedDirection = normalizePoint(direction);
  const reference =
    Math.abs(normalizedDirection.y) > 0.88
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 1, z: 0 };
  const tangent = normalizePoint(cross(reference, normalizedDirection));
  const bitangent = normalizePoint(cross(normalizedDirection, tangent));

  return { tangent, bitangent };
}

function scalePoint(point: SpatialPoint, scalar: number): SpatialPoint {
  return {
    x: point.x * scalar,
    y: point.y * scalar,
    z: point.z * scalar,
  };
}

function normalizePoint(point: SpatialPoint): SpatialPoint {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
  };
}

function cross(left: SpatialPoint, right: SpatialPoint): SpatialPoint {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function seeded(source: string, salt: string) {
  const input = `${source}:${salt}`;
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}
