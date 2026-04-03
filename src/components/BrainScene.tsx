import { Html, OrbitControls, useCursor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { buildTopologyLayout } from '../lib/layouts';
import type { HandNavigationSignal, LayoutNode, TopologyMode, VaultGraph } from '../types';

type BrainSceneProps = {
  graph: VaultGraph;
  topology: TopologyMode;
  selectedNoteId: string | null;
  activeGroup: string | null;
  searchMatchIds: Set<string> | null;
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  isPaused: boolean;
  onSelect: (noteId: string) => void;
};

export function BrainScene({
  graph,
  topology,
  selectedNoteId,
  activeGroup,
  searchMatchIds,
  handSignalRef,
  isPaused,
  onSelect,
}: BrainSceneProps) {
  const layout = useMemo(() => buildTopologyLayout(graph, topology), [graph, topology]);

  return (
    <div className="scene-shell">
      <Canvas camera={{ position: [0, 13, 17], fov: 44 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
        <fog attach="fog" args={['#07151d', 24, 58]} />
        <ambientLight intensity={1.1} />

        <SceneCore
          layout={layout}
          graph={graph}
          topology={topology}
          selectedNoteId={selectedNoteId}
          activeGroup={activeGroup}
          searchMatchIds={searchMatchIds}
          handSignalRef={handSignalRef}
          isPaused={isPaused}
          onSelect={onSelect}
        />
      </Canvas>
    </div>
  );
}

type SceneCoreProps = {
  layout: ReturnType<typeof buildTopologyLayout>;
  graph: VaultGraph;
  topology: TopologyMode;
  selectedNoteId: string | null;
  activeGroup: string | null;
  searchMatchIds: Set<string> | null;
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  isPaused: boolean;
  onSelect: (noteId: string) => void;
};

function SceneCore({
  layout,
  graph,
  topology,
  selectedNoteId,
  activeGroup,
  searchMatchIds,
  handSignalRef,
  isPaused,
  onSelect,
}: SceneCoreProps) {
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();

    for (const node of layout.nodes) {
      const withinGroup = !activeGroup || node.group === activeGroup;
      const withinSearch = !searchMatchIds || searchMatchIds.has(node.id);
      const forcedVisible = node.id === selectedNoteId;

      if ((withinGroup && withinSearch) || forcedVisible) {
        ids.add(node.id);
      }
    }

    return ids;
  }, [activeGroup, layout.nodes, searchMatchIds, selectedNoteId]);

  const allEdgePositions = useMemo(() => {
    const values: number[] = [];

    for (const edge of graph.edges) {
      if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) {
        continue;
      }

      const source = layout.nodeMap.get(edge.source);
      const target = layout.nodeMap.get(edge.target);

      if (!source || !target) {
        continue;
      }

      values.push(
        source.position[0],
        source.position[1],
        source.position[2],
        target.position[0],
        target.position[1],
        target.position[2],
      );
    }

    return new Float32Array(values);
  }, [graph.edges, layout.nodeMap, visibleIds]);

  const selectedEdgePositions = useMemo(() => {
    if (!selectedNoteId) {
      return new Float32Array();
    }

    const values: number[] = [];
    for (const edge of graph.edges) {
      if (edge.source !== selectedNoteId && edge.target !== selectedNoteId) {
        continue;
      }

      const source = layout.nodeMap.get(edge.source);
      const target = layout.nodeMap.get(edge.target);

      if (!source || !target) {
        continue;
      }

      values.push(
        source.position[0],
        source.position[1],
        source.position[2],
        target.position[0],
        target.position[1],
        target.position[2],
      );
    }

    return new Float32Array(values);
  }, [graph.edges, layout.nodeMap, selectedNoteId]);

  const labelNodeIds = useMemo(() => {
    const visibleNodes = layout.nodes.filter((node) => visibleIds.has(node.id));

    if (topology === 'clustered') {
      const labelIds = new Set<string>();
      const notesByGroup = new Map<string, LayoutNode[]>();

      for (const node of visibleNodes) {
        const existing = notesByGroup.get(node.group);
        if (existing) {
          existing.push(node);
          continue;
        }

        notesByGroup.set(node.group, [node]);
      }

      for (const nodes of notesByGroup.values()) {
        nodes.sort((left, right) => right.importance - left.importance || left.title.localeCompare(right.title));
        if (nodes[0]) {
          labelIds.add(nodes[0].id);
        }
      }

      return labelIds;
    }

    return new Set(
      [...visibleNodes]
        .sort((left, right) => right.importance - left.importance || left.title.localeCompare(right.title))
        .slice(0, 5)
        .map((node) => node.id),
    );
  }, [layout.nodes, topology, visibleIds]);

  const selectedNode = selectedNoteId ? layout.nodeMap.get(selectedNoteId) ?? null : null;

  return (
    <>
      {allEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[allEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#77b8cf" transparent opacity={0.16} />
        </lineSegments>
      ) : null}

      {selectedEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[selectedEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffd08b" transparent opacity={0.72} />
        </lineSegments>
      ) : null}

      {layout.nodes.map((node) => (
        <NoteMarker
          key={node.id}
          node={node}
          selected={node.id === selectedNoteId}
          dimmed={!visibleIds.has(node.id)}
          isHub={node.id === layout.hubNoteId}
          onSelect={onSelect}
        />
      ))}

      {layout.nodes.map((node) => {
        if (node.id === selectedNoteId || !labelNodeIds.has(node.id) || !visibleIds.has(node.id)) {
          return null;
        }

        return (
          <Html
            key={`label-${node.id}`}
            position={[node.position[0], node.position[1] + node.scale * 0.45 + 0.5, node.position[2]]}
            center
            className="node-label"
            distanceFactor={20}
          >
            <div className="node-label-card minor">
              <span>{node.title}</span>
            </div>
          </Html>
        );
      })}

      {selectedNode ? (
        <Html
          position={[selectedNode.position[0], selectedNode.position[1] + selectedNode.scale * 0.45 + 0.7, selectedNode.position[2]]}
          center
          className="node-label"
          distanceFactor={20}
        >
          <div className="node-label-card">
            <span>{selectedNode.title}</span>
            <span>{selectedNode.path}</span>
          </div>
        </Html>
      ) : null}

      <CameraRig
        handSignalRef={handSignalRef}
        layout={layout}
        isPaused={isPaused}
        onGestureSelect={onSelect}
      />
    </>
  );
}

type NoteMarkerProps = {
  node: LayoutNode;
  selected: boolean;
  dimmed: boolean;
  isHub: boolean;
  onSelect: (noteId: string) => void;
};

function NoteMarker({ node, selected, dimmed, isHub, onSelect }: NoteMarkerProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  // Scale down significantly for a neuron/brain-node look
  const baseRadius = node.scale * 0.42;
  const radius = selected ? baseRadius * 1.55 : hovered ? baseRadius * 1.2 : baseRadius;
  const color = selected ? '#ffd08b' : hovered ? '#a8dff0' : node.color;

  return (
    <group position={node.position}>
      {/* Visible node dot */}
      <mesh>
        <sphereGeometry args={[radius, 8, 6]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={dimmed ? 0.1 : selected ? 1.0 : isHub ? 0.95 : 0.82}
        />
      </mesh>
      {/* Invisible larger hit area for easier clicking */}
      <mesh
        onClick={() => onSelect(node.id)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[Math.max(radius * 2.2, 0.38), 6, 4]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

type CameraRigProps = {
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  layout: ReturnType<typeof buildTopologyLayout>;
  isPaused: boolean;
  onGestureSelect: (noteId: string) => void;
};

function CameraRig({ handSignalRef, layout, isPaused, onGestureSelect }: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();
  const dwellRef = useRef({ x: -1, y: -1, time: 0 });

  useEffect(() => {
    const controls = controlsRef.current;
    const targetHeight = Math.max(1.35, layout.radius * 0.085);
    const distance = Math.max(10.5, layout.radius * 1.05);
    const height = Math.max(7.2, layout.radius * 0.65);
    const target = new Vector3(layout.center[0], targetHeight, layout.center[2]);
    const position = new Vector3(layout.center[0], height, layout.center[2] + distance);

    camera.position.copy(position);
    camera.lookAt(target);

    if (controls) {
      controls.target.copy(target);
      controls.minDistance = 5;
      controls.maxDistance = 40;
      controls.update();
    }
  }, [camera, layout.center, layout.radius]);

  useFrame(({ camera: cam }, delta) => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const signal = handSignalRef.current;

    // Pan (from Pointing_Up gesture)
    if (Math.abs(signal.panDelta.x) > 0.001 || Math.abs(signal.panDelta.y) > 0.001) {
      const dist = controls.getDistance();
      const panScale = dist * 0.06;

      // Camera's right vector
      const right = new Vector3();
      right.subVectors(cam.position, controls.target).normalize();
      right.crossVectors(cam.up, right).normalize();

      controls.target.addScaledVector(right, signal.panDelta.x * panScale);
      cam.position.addScaledVector(right, signal.panDelta.x * panScale);

      signal.panDelta.x *= 0.72;
      signal.panDelta.y *= 0.72;
    }

    // Orbit + zoom (when not paused)
    if (signal.active && !isPaused) {
      controls.setAzimuthalAngle(controls.getAzimuthalAngle() - signal.deltaAzimuth);
      controls.setPolarAngle(clamp(signal.deltaPolar + controls.getPolarAngle(), 0.52, 1.45));

      if (Math.abs(signal.zoomDelta) > 0.004) {
        const scale = 1 + Math.min(0.28, Math.abs(signal.zoomDelta) * 3.2);
        if (signal.zoomDelta > 0) {
          controls.dollyIn(scale);
        } else {
          controls.dollyOut(scale);
        }
      }

      signal.deltaAzimuth *= 0.72;
      signal.deltaPolar *= 0.72;
      signal.zoomDelta *= 0.68;
    }

    // Dwell-select when paused
    if (isPaused) {
      const cursor = signal.cursor;
      const moved = Math.hypot(cursor.x - dwellRef.current.x, cursor.y - dwellRef.current.y);

      if (moved > 0.04) {
        dwellRef.current.x = cursor.x;
        dwellRef.current.y = cursor.y;
        dwellRef.current.time = 0;
      } else {
        dwellRef.current.time += delta;

        if (dwellRef.current.time >= 1.5) {
          dwellRef.current.time = 0;

          // Project all nodes to screen space and find nearest to cursor
          const v = new Vector3();
          let nearest: string | null = null;
          let nearestDist = Infinity;

          for (const node of layout.nodes) {
            v.set(node.position[0], node.position[1], node.position[2]);
            v.project(cam);
            if (v.z > 1) {
              continue; // behind camera
            }
            const sx = (v.x + 1) / 2;
            const sy = (1 - v.y) / 2;
            const d = Math.hypot(sx - cursor.x, sy - cursor.y);
            if (d < nearestDist) {
              nearestDist = d;
              nearest = node.id;
            }
          }

          if (nearest && nearestDist < 0.12) {
            onGestureSelect(nearest);
          }
        }
      }
    } else {
      dwellRef.current.time = 0;
    }

    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.09}
      minDistance={5}
      maxDistance={40}
      minPolarAngle={0.72}
      maxPolarAngle={1.3}
      rotateSpeed={0.72}
      zoomSpeed={0.82}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
