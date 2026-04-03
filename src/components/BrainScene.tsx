import { Html, OrbitControls, Sparkles, useCursor } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { BufferAttribute, Color, PlaneGeometry, Vector3, WireframeGeometry } from 'three';
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
  onSelect: (noteId: string) => void;
};

export function BrainScene({
  graph,
  topology,
  selectedNoteId,
  activeGroup,
  searchMatchIds,
  handSignalRef,
  onSelect,
}: BrainSceneProps) {
  const layout = useMemo(() => buildTopologyLayout(graph, topology), [graph, topology]);
  const selectedNode = selectedNoteId ? layout.nodeMap.get(selectedNoteId) ?? null : null;

  return (
    <div className="scene-shell">
      <Canvas camera={{ position: [0, 18, 30], fov: 48 }} dpr={[1, 1.8]} gl={{ antialias: true, alpha: true }}>
        <fog attach="fog" args={['#06131b', 18, 72]} />
        <ambientLight intensity={0.82} />
        <directionalLight position={[18, 22, 12]} intensity={1.35} color="#f0d7ae" />
        <directionalLight position={[-12, 10, -18]} intensity={0.8} color="#80c2dd" />
        <pointLight position={[0, 24, 0]} intensity={0.55} color="#ffb46c" />
        <Sparkles count={72} scale={[70, 24, 70]} size={1.8} speed={0.08} opacity={0.2} color="#ffe7c9" />

        <SceneCore
          layout={layout}
          graph={graph}
          selectedNoteId={selectedNoteId}
          selectedNode={selectedNode}
          activeGroup={activeGroup}
          searchMatchIds={searchMatchIds}
          handSignalRef={handSignalRef}
          onSelect={onSelect}
        />
      </Canvas>
    </div>
  );
}

type SceneCoreProps = {
  layout: ReturnType<typeof buildTopologyLayout>;
  graph: VaultGraph;
  selectedNoteId: string | null;
  selectedNode: LayoutNode | null;
  activeGroup: string | null;
  searchMatchIds: Set<string> | null;
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  onSelect: (noteId: string) => void;
};

function SceneCore({
  layout,
  graph,
  selectedNoteId,
  selectedNode,
  activeGroup,
  searchMatchIds,
  handSignalRef,
  onSelect,
}: SceneCoreProps) {
  const terrainGeometry = useMemo(() => {
    const extent = Math.max(48, layout.radius * 2.8);
    const geometry = new PlaneGeometry(extent, extent, 72, 72);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.getAttribute('position') as BufferAttribute;

    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = position.getZ(index);

      let height = 0;
      for (const node of layout.nodes) {
        const dx = x - node.position[0];
        const dz = z - node.position[2];
        const distanceSquared = dx * dx + dz * dz;
        const spread = 18 + node.scale * 20;
        const influence = Math.exp(-distanceSquared / spread);
        height += influence * (node.position[1] * 0.22 + node.scale * 0.6);
      }

      position.setY(index, height);
    }

    position.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }, [layout.nodes, layout.radius]);

  const terrainWireframe = useMemo(() => new WireframeGeometry(terrainGeometry), [terrainGeometry]);

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

  return (
    <>
      <group position={[0, -0.35, 0]}>
        <mesh geometry={terrainGeometry} receiveShadow>
          <meshStandardMaterial
            color={new Color('#0c2a35')}
            metalness={0.08}
            roughness={0.82}
            transparent
            opacity={0.92}
          />
        </mesh>
        <lineSegments geometry={terrainWireframe}>
          <lineBasicMaterial color="#7db5c5" transparent opacity={0.18} />
        </lineSegments>
      </group>

      {allEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[allEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#77b8cf" transparent opacity={0.14} />
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
          isHub={node.id === layout.hubNoteId}
          onSelect={onSelect}
        />
      ))}

      {selectedNode ? (
        <Html
          position={[selectedNode.position[0], selectedNode.position[1] + selectedNode.scale + 0.9, selectedNode.position[2]]}
          center
          className="node-label"
          distanceFactor={18}
        >
          <div className="node-label-card">
            <span>{selectedNode.title}</span>
            <span>{selectedNode.path}</span>
          </div>
        </Html>
      ) : null}

      <CameraRig handSignalRef={handSignalRef} selectedNode={selectedNode} />
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

  const scaleMultiplier = selected ? 1.48 : hovered ? 1.18 : 1;
  const radius = node.scale * scaleMultiplier;

  return (
    <group position={node.position}>
      <mesh scale={[radius * 2.8, radius * 0.12, radius * 2.8]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.65, 1, 32]} />
        <meshBasicMaterial color={selected ? '#ffd392' : node.color} transparent opacity={dimmed ? 0.05 : 0.18} />
      </mesh>
      <mesh
        onClick={() => onSelect(node.id)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        castShadow
      >
        <sphereGeometry args={[radius, 20, 20]} />
        <meshStandardMaterial
          color={selected ? '#ffd392' : node.color}
          emissive={selected ? '#ffb347' : node.color}
          emissiveIntensity={selected ? 1.2 : hovered ? 0.72 : isHub ? 0.55 : 0.34}
          transparent
          opacity={dimmed ? 0.18 : 0.96}
          roughness={0.2}
          metalness={0.08}
        />
      </mesh>
    </group>
  );
}

type CameraRigProps = {
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  selectedNode: LayoutNode | null;
};

function CameraRig({ handSignalRef, selectedNode }: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const targetVectorRef = useRef(new Vector3(0, 2, 0));

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const desiredTarget = selectedNode
      ? new Vector3(selectedNode.position[0], Math.max(1.2, selectedNode.position[1] * 0.45), selectedNode.position[2])
      : new Vector3(0, 2.2, 0);

    targetVectorRef.current.lerp(desiredTarget, 0.08);
    controls.target.lerp(targetVectorRef.current, 0.12);

    const signal = handSignalRef.current;
    if (signal.active) {
      controls.setAzimuthalAngle(controls.getAzimuthalAngle() - signal.deltaAzimuth);
      controls.setPolarAngle(clamp(signal.deltaPolar + controls.getPolarAngle(), 0.52, 1.45));

      if (Math.abs(signal.zoomDelta) > 0.004) {
        const scale = 1 + Math.min(0.32, Math.abs(signal.zoomDelta) * 3.2);
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

    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      minDistance={12}
      maxDistance={58}
      minPolarAngle={0.5}
      maxPolarAngle={1.48}
      rotateSpeed={0.72}
      zoomSpeed={0.68}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
