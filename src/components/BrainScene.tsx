import { Html, OrbitControls, useCursor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MOUSE, Vector3 } from 'three';
import type { LineBasicMaterial } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { buildTopologyLayout } from '../lib/layouts';
import type { HandNavigationSignal, LayoutNode, TopologyMode, VaultGraph, ZoomTier } from '../types';

type BrainSceneProps = {
  graph: VaultGraph;
  topology: TopologyMode;
  selectedNoteId: string | null;
  activeGroup: string | null;
  searchMatchIds: Set<string> | null;
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  isPaused: boolean;
  isGestureRunning: boolean;
  panMode: boolean;
  onSelect: (noteId: string) => void;
  onOpenNote: () => void;
  onDeselect: () => void;
};

type SceneCoreProps = {
  layout: ReturnType<typeof buildTopologyLayout>;
  graph: VaultGraph;
  topology: TopologyMode;
  selectedNoteId: string | null;
  activeGroup: string | null;
  searchMatchIds: Set<string> | null;
  performanceMode: boolean;
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  isPaused: boolean;
  isGestureRunning: boolean;
  panMode: boolean;
  onSelect: (noteId: string) => void;
  onOpenNote: () => void;
};

type ClusterAnchor = {
  key: string;
  label: string;
  position: [number, number, number];
  weight: number;
};

type NoteMarkerProps = {
  node: LayoutNode;
  selected: boolean;
  dimmed: boolean;
  hasSelection: boolean;
  isGestureRunning: boolean;
  onSelect: (noteId: string) => void;
};

type CameraRigProps = {
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  layout: ReturnType<typeof buildTopologyLayout>;
  isPaused: boolean;
  panMode: boolean;
  onGestureSelect: (noteId: string) => void;
  onOpenNote: () => void;
  zoomTierRef: React.MutableRefObject<ZoomTier>;
  onTierChange: (tier: ZoomTier) => void;
  focusTarget: [number, number, number] | null;
};

const LARGE_GRAPH_NOTE_THRESHOLD = 280;
const LARGE_GRAPH_EDGE_THRESHOLD = 1200;

export function BrainScene({
  graph,
  topology,
  selectedNoteId,
  activeGroup,
  searchMatchIds,
  handSignalRef,
  isPaused,
  isGestureRunning,
  panMode,
  onSelect,
  onOpenNote,
  onDeselect,
}: BrainSceneProps) {
  const layout = useMemo(() => buildTopologyLayout(graph, topology), [graph, topology]);
  const performanceMode =
    graph.noteCount > LARGE_GRAPH_NOTE_THRESHOLD || graph.edgeCount > LARGE_GRAPH_EDGE_THRESHOLD;

  return (
    <div className="scene-shell">
      <Canvas
        camera={{ position: [0, 2, 18], fov: 44 }}
        dpr={[1, performanceMode ? 1.15 : 1.35]}
        gl={{ antialias: !performanceMode, alpha: true }}
        onPointerMissed={() => onDeselect()}
      >
        <fog attach="fog" args={['#07151d', 28, 72]} />
        <ambientLight intensity={1.05} />

        <SceneCore
          layout={layout}
          graph={graph}
          topology={topology}
          selectedNoteId={selectedNoteId}
          activeGroup={activeGroup}
          searchMatchIds={searchMatchIds}
          performanceMode={performanceMode}
          handSignalRef={handSignalRef}
          isPaused={isPaused}
          isGestureRunning={isGestureRunning}
          panMode={panMode}
          onSelect={onSelect}
          onOpenNote={onOpenNote}
        />
      </Canvas>
    </div>
  );
}

function SceneCore({
  layout,
  graph,
  topology,
  selectedNoteId,
  activeGroup,
  searchMatchIds,
  performanceMode,
  handSignalRef,
  isPaused,
  isGestureRunning,
  panMode,
  onSelect,
  onOpenNote,
}: SceneCoreProps) {
  const zoomTierRef = useRef<ZoomTier>('explore');
  const [zoomTier, setZoomTier] = useState<ZoomTier>('explore');
  const handleTierChange = useCallback((tier: ZoomTier) => setZoomTier(tier), []);

  const allEdgeMaterialRef = useRef<LineBasicMaterial | null>(null);
  const strongEdgeMaterialRef = useRef<LineBasicMaterial | null>(null);

  useFrame(() => {
    const tier = zoomTierRef.current;

    if (allEdgeMaterialRef.current) {
      const target = tier === 'atlas' ? 0 : tier === 'explore' ? 0.035 : 0.07;
      allEdgeMaterialRef.current.opacity += (target - allEdgeMaterialRef.current.opacity) * 0.06;
    }

    if (strongEdgeMaterialRef.current) {
      const target = tier === 'atlas' ? 0.16 : tier === 'explore' ? 0.12 : 0.1;
      strongEdgeMaterialRef.current.opacity += (target - strongEdgeMaterialRef.current.opacity) * 0.06;
    }
  });

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

  const importanceThreshold = useMemo(() => {
    const values = layout.nodes.map((node) => node.importance).sort((left, right) => right - left);
    return values[Math.floor(values.length * 0.33)] ?? 0;
  }, [layout.nodes]);

  const maxImportance = useMemo(
    () => Math.max(...layout.nodes.map((node) => node.importance), 1),
    [layout.nodes],
  );

  const allEdgePositions = useMemo(() => {
    const values: number[] = [];

    for (const edge of graph.edges) {
      if (performanceMode && edge.kind === 'sibling') continue;
      if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;

      const source = layout.nodeMap.get(edge.source);
      const target = layout.nodeMap.get(edge.target);
      if (!source || !target) continue;

      values.push(
        source.position[0], source.position[1], source.position[2],
        target.position[0], target.position[1], target.position[2],
      );
    }

    return new Float32Array(values);
  }, [graph.edges, layout.nodeMap, performanceMode, visibleIds]);

  const strongEdgePositions = useMemo(() => {
    const values: number[] = [];

    for (const edge of graph.edges) {
      if (edge.kind === 'sibling') continue;
      if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;

      const source = layout.nodeMap.get(edge.source);
      const target = layout.nodeMap.get(edge.target);
      if (!source || !target) continue;
      if (source.importance < importanceThreshold || target.importance < importanceThreshold) continue;

      values.push(
        source.position[0], source.position[1], source.position[2],
        target.position[0], target.position[1], target.position[2],
      );
    }

    return new Float32Array(values);
  }, [graph.edges, importanceThreshold, layout.nodeMap, visibleIds]);

  const selectedEdgePositions = useMemo(() => {
    if (!selectedNoteId) {
      return new Float32Array();
    }

    const values: number[] = [];
    for (const edge of graph.edges) {
      if (edge.source !== selectedNoteId && edge.target !== selectedNoteId) continue;

      const source = layout.nodeMap.get(edge.source);
      const target = layout.nodeMap.get(edge.target);
      if (!source || !target) continue;

      values.push(
        source.position[0], source.position[1], source.position[2],
        target.position[0], target.position[1], target.position[2],
      );
    }

    return new Float32Array(values);
  }, [graph.edges, layout.nodeMap, selectedNoteId]);

  const visibleLabelIds = useMemo(() => {
    const tierLimit = performanceMode
      ? zoomTier === 'atlas'
        ? 6
        : zoomTier === 'explore'
          ? 12
          : 20
      : zoomTier === 'atlas'
        ? 10
        : zoomTier === 'explore'
          ? 18
          : 28;

    const candidates = layout.nodes
      .filter((node) => visibleIds.has(node.id) && node.id !== selectedNoteId)
      .map((node) => ({
        node,
        emphasis: searchMatchIds?.has(node.id) ? 1 : 0,
        importanceRatio: node.importance / maxImportance,
      }))
      .filter(({ emphasis, importanceRatio }) => {
        if (zoomTier === 'atlas') {
          return emphasis === 1 || importanceRatio >= 0.72;
        }
        if (zoomTier === 'explore') {
          return emphasis === 1 || importanceRatio >= 0.48;
        }
        return emphasis === 1 || importanceRatio >= (performanceMode ? 0.26 : 0.18);
      })
      .sort((left, right) => {
        return (
          right.emphasis - left.emphasis ||
          right.node.importance - left.node.importance ||
          left.node.title.localeCompare(right.node.title)
        );
      })
      .slice(0, tierLimit);

    return new Set(candidates.map(({ node }) => node.id));
  }, [layout.nodes, maxImportance, performanceMode, searchMatchIds, selectedNoteId, visibleIds, zoomTier]);

  const clusterAnchors = useMemo(() => {
    if (topology !== 'clustered') {
      return [] as ClusterAnchor[];
    }

    const groups = new Map<string, LayoutNode[]>();
    for (const node of layout.nodes) {
      const bucket = groups.get(node.group);
      if (bucket) {
        bucket.push(node);
      } else {
        groups.set(node.group, [node]);
      }
    }

    return Array.from(groups.entries())
      .map(([key, nodes]) => {
        const cx = nodes.reduce((sum, node) => sum + node.position[0], 0) / nodes.length;
        const cy = nodes.reduce((sum, node) => sum + node.position[1], 0) / nodes.length;
        const cz = nodes.reduce((sum, node) => sum + node.position[2], 0) / nodes.length;
        const topNode = nodes.reduce((best, node) => (node.importance > best.importance ? node : best), nodes[0]!);

        return {
          key,
          label: topNode.group || key,
          position: [cx, cy + 1.8, cz] as [number, number, number],
          weight: nodes.reduce((sum, node) => sum + node.importance, 0),
        };
      })
      .sort((left, right) => right.weight - left.weight || left.label.localeCompare(right.label));
  }, [layout.nodes, topology]);

  const selectedNode = selectedNoteId ? layout.nodeMap.get(selectedNoteId) ?? null : null;
  const labelDistanceFactor = zoomTier === 'atlas' ? 18 : 14;

  return (
    <>
      {zoomTier !== 'atlas' && allEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[allEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial ref={allEdgeMaterialRef} color="#77b8cf" transparent opacity={0.035} />
        </lineSegments>
      ) : null}

      {strongEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[strongEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial ref={strongEdgeMaterialRef} color="#88c4d8" transparent opacity={0.12} />
        </lineSegments>
      ) : null}

      {selectedEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[selectedEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffd08b" transparent opacity={0.62} />
        </lineSegments>
      ) : null}

      {layout.nodes.map((node) => (
        <NoteMarker
          key={node.id}
          node={node}
          selected={node.id === selectedNoteId}
          dimmed={!visibleIds.has(node.id)}
          hasSelection={selectedNoteId !== null}
          isGestureRunning={isGestureRunning}
          onSelect={onSelect}
        />
      ))}

      {layout.nodes.map((node) => {
        if (!visibleLabelIds.has(node.id)) {
          return null;
        }

        const title = node.title.length > 22 ? `${node.title.slice(0, 20)}…` : node.title;
        return (
          <Html
            key={`label-${node.id}`}
            position={[node.position[0], node.position[1] + node.scale * 0.28 + 0.38, node.position[2]]}
            center
            className="node-label"
            distanceFactor={labelDistanceFactor}
          >
            <div className="node-label-card minor">
              <span>{title}</span>
            </div>
          </Html>
        );
      })}

      {zoomTier === 'atlas' && clusterAnchors.slice(0, performanceMode ? 6 : 8).map((anchor) => (
        <Html
          key={`cluster-label-${anchor.key}`}
          position={anchor.position}
          center
          className="node-label"
          distanceFactor={11}
        >
          <div className="node-label-card">
            <span>{capitalizeFirst(anchor.label)}</span>
          </div>
        </Html>
      ))}

      {selectedNode ? (
        <Html
          position={[
            selectedNode.position[0],
            selectedNode.position[1] + selectedNode.scale * 0.45 + 0.7,
            selectedNode.position[2],
          ]}
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
        panMode={panMode}
        onGestureSelect={onSelect}
        onOpenNote={onOpenNote}
        zoomTierRef={zoomTierRef}
        onTierChange={handleTierChange}
        focusTarget={selectedNode ? selectedNode.position : null}
      />
    </>
  );
}

function NoteMarker({ node, selected, dimmed, hasSelection, isGestureRunning, onSelect }: NoteMarkerProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  const baseRadius = node.scale * 0.28;
  const radius = selected ? baseRadius * 1.55 : hovered ? baseRadius * 1.22 : baseRadius;
  const color = selected ? '#ffd777' : hovered ? '#7de8ff' : node.color;
  const dimOpacity = hasSelection ? 0.04 : 0.08;
  const opacity = dimmed ? dimOpacity : selected ? 1 : hovered ? 1 : 0.9;

  return (
    <group position={node.position}>
      {selected ? (
        <mesh>
          <sphereGeometry args={[radius * 2.4, 10, 8]} />
          <meshBasicMaterial color="#ffd777" transparent opacity={0.16} wireframe />
        </mesh>
      ) : null}

      <mesh>
        <sphereGeometry args={[radius, 6, 4]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>

      <mesh
        onClick={() => onSelect(node.id)}
        onPointerOver={() => {
          if (!isGestureRunning) {
            setHovered(true);
          }
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[Math.max(radius * 2.6, 0.4), 6, 4]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

function CameraRig({
  handSignalRef,
  layout,
  isPaused,
  panMode,
  onGestureSelect,
  onOpenNote,
  zoomTierRef,
  onTierChange,
  focusTarget,
}: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    const controls = controlsRef.current;
    const distance = Math.max(11.5, layout.radius * 1.18);
    const target = new Vector3(layout.center[0], layout.center[1], layout.center[2]);
    const position = new Vector3(
      layout.center[0] + layout.radius * 0.42,
      layout.center[1] + Math.max(2.4, layout.radius * 0.3),
      layout.center[2] + distance,
    );

    camera.position.copy(position);
    camera.lookAt(target);

    if (controls) {
      controls.target.copy(target);
      controls.minDistance = 5;
      controls.maxDistance = Math.max(40, layout.radius * 4.2);
      controls.update();
    }
  }, [camera, layout.center, layout.radius]);

  useFrame(({ camera: activeCamera }) => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const signal = handSignalRef.current;

    if (Math.abs(signal.panDelta.x) > 0.001 || Math.abs(signal.panDelta.y) > 0.001) {
      const distance = controls.getDistance();
      const panScale = distance * 0.06;

      const right = new Vector3();
      right.subVectors(activeCamera.position, controls.target).normalize();
      right.crossVectors(activeCamera.up, right).normalize();

      controls.target.addScaledVector(right, signal.panDelta.x * panScale);
      activeCamera.position.addScaledVector(right, signal.panDelta.x * panScale);

      controls.target.y -= signal.panDelta.y * panScale;
      activeCamera.position.y -= signal.panDelta.y * panScale;

      signal.panDelta.x *= 0.72;
      signal.panDelta.y *= 0.72;
    }

    if (signal.active && !isPaused) {
      controls.setAzimuthalAngle(controls.getAzimuthalAngle() - signal.deltaAzimuth);
      controls.setPolarAngle(clamp(signal.deltaPolar + controls.getPolarAngle(), 0.24, Math.PI - 0.24));

      if (Math.abs(signal.zoomDelta) > 0.004) {
        const scale = 1 + Math.min(0.14, Math.abs(signal.zoomDelta) * 2);
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

    if (focusTarget && !signal.active) {
      const targetY = focusTarget[1] + 1;
      controls.target.x += (focusTarget[0] - controls.target.x) * 0.04;
      controls.target.y += (targetY - controls.target.y) * 0.04;
      controls.target.z += (focusTarget[2] - controls.target.z) * 0.04;
    }

    controls.update();

    if (signal.gestureTrigger) {
      const { type, cursor } = signal.gestureTrigger;
      signal.gestureTrigger = null;

      const projected = new Vector3();
      let nearest: string | null = null;
      let nearestDistance = Infinity;

      for (const node of layout.nodes) {
        projected.set(node.position[0], node.position[1], node.position[2]);
        projected.project(activeCamera);
        if (projected.z > 1) continue;

        const screenX = (projected.x + 1) / 2;
        const screenY = (1 - projected.y) / 2;
        const distance = Math.hypot(screenX - cursor.x, screenY - cursor.y);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = node.id;
        }
      }

      if (nearest && nearestDistance < 0.15) {
        if (type === 'select') {
          onGestureSelect(nearest);
        } else {
          onOpenNote();
        }
      }
    }

    const distance = controls.getDistance();
    const currentTier = zoomTierRef.current;
    let nextTier = currentTier;
    const hysteresis = 1;

    if (currentTier !== 'atlas' && distance > 22 + hysteresis) nextTier = 'atlas';
    else if (currentTier === 'atlas' && distance < 22 - hysteresis) nextTier = 'explore';
    else if (currentTier !== 'close' && distance < 10 - hysteresis) nextTier = 'close';
    else if (currentTier === 'close' && distance > 10 + hysteresis) nextTier = 'explore';

    if (nextTier !== currentTier) {
      zoomTierRef.current = nextTier;
      onTierChange(nextTier);
    }
  });

  const mouseButtons = panMode
    ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
    : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.09}
      minDistance={5}
      maxDistance={40}
      minPolarAngle={0.24}
      maxPolarAngle={Math.PI - 0.24}
      rotateSpeed={0.72}
      zoomSpeed={0.82}
      mouseButtons={mouseButtons}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function capitalizeFirst(value: string) {
  if (!value) {
    return value;
  }

  const word = value.split(/[\s_-]/)[0] ?? value;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
