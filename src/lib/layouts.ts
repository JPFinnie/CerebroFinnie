import type { LayoutNode, LayoutResult, TopologyMode, VaultGraph, VaultNote } from '../types';

const TAU = Math.PI * 2;

type FlatPoint = {
  x: number;
  z: number;
};

export function buildTopologyLayout(graph: VaultGraph, topology: TopologyMode): LayoutResult {
  const notes = graph.notes;
  const maxImportance = Math.max(...notes.map((note) => note.importance), 1);
  const hubNoteId = notes[0]?.id ?? null;

  const flatPoints =
    topology === 'centralized'
      ? buildCentralizedLayout(graph, hubNoteId)
      : topology === 'clustered'
        ? buildClusteredLayout(graph)
        : buildDistributedLayout(graph);

  const radius = Math.max(
    18,
    ...notes.map((note) => {
      const point = flatPoints.get(note.id);
      if (!point) {
        return 0;
      }

      return Math.hypot(point.x, point.z);
    }),
  );

  const nodes: LayoutNode[] = notes.map((note) => {
    const point = flatPoints.get(note.id) ?? { x: 0, z: 0 };
    const scale = 0.34 + Math.pow(note.importance / maxImportance, 1.08) * 0.9;
    const y =
      0.9 +
      Math.pow(note.importance / maxImportance, 1.15) * 7.4 +
      Math.min(note.incomingCount * 0.05, 1.5);

    return {
      ...note,
      position: [point.x, y, point.z],
      scale,
    };
  });

  return {
    nodes,
    nodeMap: new Map(nodes.map((node) => [node.id, node])),
    radius,
    hubNoteId,
  };
}

function buildCentralizedLayout(graph: VaultGraph, hubNoteId: string | null) {
  const positions = new Map<string, FlatPoint>();
  if (!hubNoteId) {
    return positions;
  }

  const distances = getUndirectedDistances(graph, hubNoteId);
  const buckets = new Map<number, VaultNote[]>();

  for (const note of graph.notes) {
    if (note.id === hubNoteId) {
      positions.set(note.id, { x: 0, z: 0 });
      continue;
    }

    const rawDistance = distances.get(note.id);
    const distance = Number.isFinite(rawDistance) ? (rawDistance ?? 5) : 5;
    const existingBucket = buckets.get(distance);

    if (existingBucket) {
      existingBucket.push(note);
      continue;
    }

    buckets.set(distance, [note]);
  }

  for (const [distance, notes] of Array.from(buckets.entries()).sort((left, right) => left[0] - right[0])) {
    const radius = 6.5 + distance * 4.2;
    notes.sort((left, right) => right.importance - left.importance || left.title.localeCompare(right.title));

    notes.forEach((note, index) => {
      const angle = (index / notes.length) * TAU + seeded(note.id, 'central-angle') * 0.85;
      const wobble = seeded(note.id, 'central-radius') * 1.8;

      positions.set(note.id, {
        x: Math.cos(angle) * (radius + wobble),
        z: Math.sin(angle) * (radius + wobble),
      });
    });
  }

  return positions;
}

function buildClusteredLayout(graph: VaultGraph) {
  const positions = new Map<string, FlatPoint>();
  const groupedNotes = Array.from(groupBy(graph.notes, (note) => note.group).entries()).sort(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]),
  );

  const hubRadius = Math.max(12, groupedNotes.length * 2.6);

  groupedNotes.forEach(([group, notes], groupIndex) => {
    const groupAngle = groupedNotes.length === 1 ? 0 : (groupIndex / groupedNotes.length) * TAU + Math.PI / 14;
    const clusterCenter =
      groupedNotes.length === 1
        ? { x: 0, z: 0 }
        : {
            x: Math.cos(groupAngle) * hubRadius,
            z: Math.sin(groupAngle) * hubRadius * 0.82,
          };

    const sortedNotes = [...notes].sort(
      (left, right) => right.importance - left.importance || left.title.localeCompare(right.title),
    );

    sortedNotes.forEach((note, noteIndex) => {
      if (noteIndex === 0) {
        positions.set(note.id, clusterCenter);
        return;
      }

      const arm = Math.ceil(noteIndex / 3);
      const localAngle =
        noteIndex * 1.47 + groupIndex * 0.8 + seeded(`${group}:${note.id}`, 'cluster-angle') * Math.PI;
      const localRadius = 2.6 + Math.sqrt(arm) * 2.35 + seeded(note.id, 'cluster-radius') * 1.4;

      positions.set(note.id, {
        x: clusterCenter.x + Math.cos(localAngle) * localRadius,
        z: clusterCenter.z + Math.sin(localAngle) * localRadius,
      });
    });
  });

  return positions;
}

function buildDistributedLayout(graph: VaultGraph) {
  const notes = graph.notes;
  const indexMap = new Map(notes.map((note, index) => [note.id, index]));
  const positions = notes.map((note, index) => {
    const angle = seeded(note.id, `distributed-angle-${index}`) * TAU;
    const radius = 5 + seeded(note.id, `distributed-radius-${index}`) * 16;

    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      vx: 0,
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
        const dz = a.z - b.z;
        const distanceSquared = dx * dx + dz * dz + 0.22;
        const distance = Math.sqrt(distanceSquared);
        const repel = 6.4 / distanceSquared;
        const nx = dx / distance;
        const nz = dz / distance;

        a.vx += nx * repel;
        a.vz += nz * repel;
        b.vx -= nx * repel;
        b.vz -= nz * repel;
      }
    }

    for (const link of links) {
      const source = positions[link.source];
      const target = positions[link.target];
      const dx = target.x - source.x;
      const dz = target.z - source.z;
      const distance = Math.sqrt(dx * dx + dz * dz) + 0.001;
      const spring = (distance - 5.4) * 0.017;
      const nx = dx / distance;
      const nz = dz / distance;

      source.vx += nx * spring;
      source.vz += nz * spring;
      target.vx -= nx * spring;
      target.vz -= nz * spring;
    }

    for (const point of positions) {
      point.vx += -point.x * 0.0052;
      point.vz += -point.z * 0.0052;
      point.vx *= 0.74;
      point.vz *= 0.74;
      point.x += point.vx;
      point.z += point.vz;
    }
  }

  const furthest = Math.max(...positions.map((point) => Math.hypot(point.x, point.z)), 1);
  const scale = 24 / furthest;

  return new Map(
    notes.map((note, index) => [
      note.id,
      {
        x: positions[index].x * scale,
        z: positions[index].z * scale,
      },
    ]),
  );
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
