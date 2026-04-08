import type { LayoutNode, LayoutResult, TopologyMode, VaultGraph, VaultNote } from '../types';

const TAU = Math.PI * 2;

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
  const groupedNotes = Array.from(groupBy(graph.notes, (note) => note.group).entries()).sort(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]),
  );

  const hubRadius = Math.max(4.8, groupedNotes.length * 0.92);

  groupedNotes.forEach(([group, notes], groupIndex) => {
    const groupT = groupedNotes.length === 1 ? 0.5 : groupIndex / Math.max(1, groupedNotes.length - 1);
    const groupAngle = groupedNotes.length === 1 ? 0 : (groupIndex / groupedNotes.length) * TAU + Math.PI / 10;
    const clusterCenter =
      groupedNotes.length === 1
        ? { x: 0, y: 0, z: 0 }
        : {
            x: Math.cos(groupAngle) * hubRadius * 0.98,
            y: (groupT - 0.5) * hubRadius * 1.22 + Math.sin(groupAngle * 1.45) * 0.9,
            z: Math.sin(groupAngle) * hubRadius * 0.84,
          };

    const sortedNotes = [...notes].sort(
      (left, right) => right.importance - left.importance || left.title.localeCompare(right.title),
    );

    sortedNotes.forEach((note, noteIndex) => {
      if (noteIndex === 0) {
        positions.set(note.id, clusterCenter);
        return;
      }

      const shell = 1.6 + Math.sqrt(Math.ceil(noteIndex / 3)) * 1.35 + seeded(note.id, 'cluster-shell') * 1.05;
      const azimuth =
        noteIndex * 1.5 + groupIndex * 0.76 + seeded(`${group}:${note.id}`, 'cluster-angle') * Math.PI;
      const pitch = (seeded(note.id, 'cluster-pitch') - 0.5) * 1.42 + Math.sin(noteIndex * 0.82) * 0.1;
      const spread = shell * Math.sqrt(Math.max(0.22, 1 - pitch * pitch * 0.45));

      positions.set(note.id, {
        x: clusterCenter.x + Math.cos(azimuth) * spread,
        y: clusterCenter.y + pitch * shell * 0.9,
        z: clusterCenter.z + Math.sin(azimuth) * spread,
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
    const radius = 3.6 + seeded(note.id, `distributed-radius-${index}`) * 10.8;
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

      return { source, target };
    })
    .filter((value): value is { source: number; target: number } => value !== null);

  for (let iteration = 0; iteration < 170; iteration += 1) {
    for (let left = 0; left < positions.length; left += 1) {
      for (let right = left + 1; right < positions.length; right += 1) {
        const a = positions[left];
        const b = positions[right];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dz = a.z - b.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz + 0.26;
        const distance = Math.sqrt(distanceSquared);
        const repel = 5 / distanceSquared;
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
      const spring = (distance - 3.5) * 0.018;
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
      point.vx += -point.x * 0.0058;
      point.vy += -point.y * 0.0062;
      point.vz += -point.z * 0.0058;
      point.vx *= 0.78;
      point.vy *= 0.78;
      point.vz *= 0.78;
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
      return 10.5;
    case 'clustered':
      return 11.4;
    case 'distributed':
      return 10.8;
    default:
      return 10.8;
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

function seeded(source: string, salt: string) {
  const input = `${source}:${salt}`;
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}
