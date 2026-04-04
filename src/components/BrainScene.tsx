import { Html, OrbitControls, useCursor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { buildTopologyLayout } from '../lib/layouts';
import type { HandNavigationSignal, LayoutNode, TopologyMode, VaultGraph, ZoomTier } from '../types';

// ── Cluster glow texture (radial gradient, white-to-transparent) ──────────────
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.26)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ── BrainScene (canvas wrapper) ───────────────────────────────────────────────

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

// ── SceneCore ─────────────────────────────────────────────────────────────────

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
  // ── Zoom tier state (used for JSX label/glow conditionals) ─────────────────
  const zoomTierRef = useRef<ZoomTier>('explore');
  const [zoomTier, setZoomTier] = useState<ZoomTier>('explore');
  const handleTierChange = useCallback((t: ZoomTier) => setZoomTier(t), []);

  // ── Material refs for frame-loop opacity animation ─────────────────────────
  const allEdgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);
  const strongEdgeMaterialRef = useRef<THREE.LineBasicMaterial | null>(null);

  // ── Animate edge opacity based on zoom tier ────────────────────────────────
  useFrame(() => {
    const tier = zoomTierRef.current;
    if (allEdgeMaterialRef.current) {
      const target = tier === 'atlas' ? 0.0 : tier === 'explore' ? 0.11 : 0.2;
      allEdgeMaterialRef.current.opacity += (target - allEdgeMaterialRef.current.opacity) * 0.06;
    }
    if (strongEdgeMaterialRef.current) {
      const target = tier === 'atlas' ? 0.28 : tier === 'explore' ? 0.22 : 0.18;
      strongEdgeMaterialRef.current.opacity += (target - strongEdgeMaterialRef.current.opacity) * 0.06;
    }
  });

  // ── Visible node set ───────────────────────────────────────────────────────
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

  // ── Importance thresholds for zoom-aware edges ─────────────────────────────
  const importanceThreshold = useMemo(() => {
    const vals = layout.nodes.map((n) => n.importance).sort((a, b) => b - a);
    return vals[Math.floor(vals.length * 0.33)] ?? 0;
  }, [layout.nodes]);

  const maxImportance = useMemo(
    () => Math.max(...layout.nodes.map((n) => n.importance), 1),
    [layout.nodes],
  );

  // ── Edge position buffers ──────────────────────────────────────────────────
  const allEdgePositions = useMemo(() => {
    const values: number[] = [];
    for (const edge of graph.edges) {
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
  }, [graph.edges, layout.nodeMap, visibleIds]);

  const strongEdgePositions = useMemo(() => {
    const values: number[] = [];
    for (const edge of graph.edges) {
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
  }, [graph.edges, layout.nodeMap, visibleIds, importanceThreshold]);

  const selectedEdgePositions = useMemo(() => {
    if (!selectedNoteId) return new Float32Array();
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

  // ── Zoom-aware label set ───────────────────────────────────────────────────
  const visibleLabelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of layout.nodes) {
      if (!visibleIds.has(node.id) || node.id === selectedNoteId) continue;
      const imp = node.importance / maxImportance;
      if (zoomTier === 'atlas' && imp >= 0.72) ids.add(node.id);
      else if (zoomTier === 'explore' && (imp >= 0.38 || searchMatchIds?.has(node.id))) ids.add(node.id);
      else if (zoomTier === 'close') ids.add(node.id);
    }
    return ids;
  }, [layout.nodes, visibleIds, selectedNoteId, zoomTier, maxImportance, searchMatchIds]);

  // ── Cluster region glows ───────────────────────────────────────────────────
  const clusterRegions = useMemo(() => {
    if (topology !== 'clustered') return [];
    const groups = new Map<string, LayoutNode[]>();
    for (const node of layout.nodes) {
      if (!groups.has(node.group)) groups.set(node.group, []);
      groups.get(node.group)!.push(node);
    }
    return Array.from(groups.entries()).map(([key, nodes]) => {
      const cx = nodes.reduce((s, n) => s + n.position[0], 0) / nodes.length;
      const cz = nodes.reduce((s, n) => s + n.position[2], 0) / nodes.length;
      const radius =
        Math.max(2.5, ...nodes.map((n) => Math.hypot(n.position[0] - cx, n.position[2] - cz))) * 1.4;
      const color = nodes[0]?.color ?? '#5599bb';
      // Cluster label: highest-importance node title in this group
      const topNode = nodes.reduce((best, n) => (n.importance > best.importance ? n : best), nodes[0]!);
      return { key, cx, cz, radius, color, label: topNode.group || key, cy: 3.5 };
    });
  }, [layout.nodes, topology]);

  const glowTexture = useMemo(() => makeGlowTexture(), []);

  const selectedNode = selectedNoteId ? layout.nodeMap.get(selectedNoteId) ?? null : null;
  const hasSelection = selectedNoteId !== null;
  const labelDistanceFactor = zoomTier === 'atlas' ? 18 : 14;

  return (
    <>
      {/* All-edge lines (faint, animated by useFrame) */}
      {allEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[allEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial ref={allEdgeMaterialRef} color="#77b8cf" transparent opacity={0.11} />
        </lineSegments>
      ) : null}

      {/* Strong edges (top-33% nodes) — always visible skeleton */}
      {strongEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[strongEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial ref={strongEdgeMaterialRef} color="#88c4d8" transparent opacity={0.22} />
        </lineSegments>
      ) : null}

      {/* Selected node edges */}
      {selectedEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[selectedEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffd08b" transparent opacity={0.72} />
        </lineSegments>
      ) : null}

      {/* Cluster region glows */}
      {clusterRegions.map((r) => (
        <ClusterGlow
          key={r.key}
          cx={r.cx}
          cz={r.cz}
          radius={r.radius}
          color={r.color}
          glowTexture={glowTexture}
          show={zoomTier === 'atlas' || zoomTier === 'explore'}
        />
      ))}

      {/* Nodes */}
      {layout.nodes.map((node) => (
        <NoteMarker
          key={node.id}
          node={node}
          selected={node.id === selectedNoteId}
          dimmed={!visibleIds.has(node.id)}
          isHub={node.id === layout.hubNoteId}
          hasSelection={hasSelection}
          onSelect={onSelect}
        />
      ))}

      {/* Node labels — zoom-aware */}
      {layout.nodes.map((node) => {
        if (!visibleLabelIds.has(node.id)) return null;
        const title = node.title.length > 22 ? node.title.slice(0, 20) + '…' : node.title;
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

      {/* Cluster title labels — shown in atlas tier only */}
      {zoomTier === 'atlas' && clusterRegions.map((r) => (
        <Html
          key={`cluster-label-${r.key}`}
          position={[r.cx, r.cy, r.cz]}
          center
          className="node-label"
          distanceFactor={10}
        >
          <div className="node-label-card">
            <span>{capitalizeFirst(r.label)}</span>
          </div>
        </Html>
      ))}

      {/* Selected node label */}
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
        onGestureSelect={onSelect}
        zoomTierRef={zoomTierRef}
        onTierChange={handleTierChange}
        focusTarget={selectedNode ? selectedNode.position : null}
      />
    </>
  );
}

// ── ClusterGlow ───────────────────────────────────────────────────────────────

type ClusterGlowProps = {
  cx: number;
  cz: number;
  radius: number;
  color: string;
  glowTexture: THREE.Texture;
  show: boolean;
};

function ClusterGlow({ cx, cz, radius, color, glowTexture, show }: ClusterGlowProps) {
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useFrame(() => {
    if (materialRef.current) {
      const target = show ? 0.08 : 0;
      materialRef.current.opacity += (target - materialRef.current.opacity) * 0.05;
    }
  });

  return (
    <mesh position={[cx, 0.05, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial
        ref={materialRef}
        map={glowTexture}
        color={color}
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ── NoteMarker ────────────────────────────────────────────────────────────────

type NoteMarkerProps = {
  node: LayoutNode;
  selected: boolean;
  dimmed: boolean;
  isHub: boolean;
  hasSelection: boolean;
  onSelect: (noteId: string) => void;
};

function NoteMarker({ node, selected, dimmed, isHub, hasSelection, onSelect }: NoteMarkerProps) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  const baseRadius = node.scale * 0.28;
  const radius = selected ? baseRadius * 1.7 : hovered ? baseRadius * 1.3 : baseRadius;
  const color = selected ? '#ffd777' : hovered ? '#7de8ff' : node.color;

  // Aggressive dimming when something is selected
  const dimOpacity = hasSelection ? 0.04 : 0.08;
  const opacity = dimmed ? dimOpacity : selected ? 1.0 : isHub ? 1.0 : hovered ? 1.0 : 0.9;
  const glowOpacity = dimmed ? 0 : selected ? 0.18 : 0.06;

  return (
    <group position={node.position}>
      {/* Selection halo ring */}
      {selected && (
        <mesh>
          <sphereGeometry args={[radius * 2.8, 12, 8]} />
          <meshBasicMaterial color="#ffd777" transparent opacity={0.18} wireframe />
        </mesh>
      )}
      {/* Outer glow halo */}
      {glowOpacity > 0 && (
        <mesh>
          <sphereGeometry args={[radius * 2.4, 5, 3]} />
          <meshBasicMaterial color={color} transparent opacity={glowOpacity} />
        </mesh>
      )}
      {/* Visible node */}
      <mesh>
        <sphereGeometry args={[radius, 6, 4]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {/* Invisible hit area */}
      <mesh
        onClick={() => onSelect(node.id)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[Math.max(radius * 2.8, 0.42), 6, 4]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

// ── CameraRig ─────────────────────────────────────────────────────────────────

type CameraRigProps = {
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  layout: ReturnType<typeof buildTopologyLayout>;
  isPaused: boolean;
  onGestureSelect: (noteId: string) => void;
  zoomTierRef: React.MutableRefObject<ZoomTier>;
  onTierChange: (t: ZoomTier) => void;
  focusTarget: [number, number, number] | null;
};

function CameraRig({
  handSignalRef,
  layout,
  isPaused,
  onGestureSelect,
  zoomTierRef,
  onTierChange,
  focusTarget,
}: CameraRigProps) {
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
    if (!controls) return;

    const signal = handSignalRef.current;

    // Pan (Pointing_Up gesture) — horizontal and vertical
    if (Math.abs(signal.panDelta.x) > 0.001 || Math.abs(signal.panDelta.y) > 0.001) {
      const dist = controls.getDistance();
      const panScale = dist * 0.06;

      const right = new Vector3();
      right.subVectors(cam.position, controls.target).normalize();
      right.crossVectors(cam.up, right).normalize();

      controls.target.addScaledVector(right, signal.panDelta.x * panScale);
      cam.position.addScaledVector(right, signal.panDelta.x * panScale);

      // Vertical pan — screen Y is inverted relative to world Y
      controls.target.y -= signal.panDelta.y * panScale;
      cam.position.y -= signal.panDelta.y * panScale;

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

    // Smooth camera focus toward selected node (only when not actively gesturing)
    if (focusTarget && !signal.active) {
      const targetY = focusTarget[1] + 1.0;
      controls.target.x += (focusTarget[0] - controls.target.x) * 0.04;
      controls.target.y += (targetY - controls.target.y) * 0.04;
      controls.target.z += (focusTarget[2] - controls.target.z) * 0.04;
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

          const v = new Vector3();
          let nearest: string | null = null;
          let nearestDist = Infinity;

          for (const node of layout.nodes) {
            v.set(node.position[0], node.position[1], node.position[2]);
            v.project(cam);
            if (v.z > 1) continue;
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

    // Zoom tier classification with hysteresis
    const dist = controls.getDistance();
    const cur = zoomTierRef.current;
    let next = cur;
    const H = 1.0;
    if (cur !== 'atlas' && dist > 22 + H) next = 'atlas';
    else if (cur === 'atlas' && dist < 22 - H) next = 'explore';
    else if (cur !== 'close' && dist < 10 - H) next = 'close';
    else if (cur === 'close' && dist > 10 + H) next = 'explore';
    if (next !== cur) {
      zoomTierRef.current = next;
      onTierChange(next);
    }
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function capitalizeFirst(str: string) {
  if (!str) return str;
  const word = str.split(/[\s_-]/)[0] ?? str;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
