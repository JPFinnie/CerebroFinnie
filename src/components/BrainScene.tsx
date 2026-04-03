import { Html, OrbitControls, Sparkles, useCursor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
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

  return (
    <div className="scene-shell">
      <Canvas camera={{ position: [0, 13, 17], fov: 44 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
        <fog attach="fog" args={['#07151d', 22, 52]} />
        <ambientLight intensity={0.92} />
        <directionalLight position={[18, 22, 12]} intensity={1.45} color="#f0d7ae" />
        <directionalLight position={[-12, 10, -18]} intensity={0.9} color="#80c2dd" />
        <pointLight position={[0, 18, 0]} intensity={0.42} color="#ffb46c" />
        <Sparkles count={16} scale={[28, 12, 28]} size={1.35} speed={0.08} opacity={0.08} color="#ffe7c9" />

        <SceneCore
          layout={layout}
          graph={graph}
          topology={topology}
          selectedNoteId={selectedNoteId}
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
  topology: TopologyMode;
  selectedNoteId: string | null;
  activeGroup: string | null;
  searchMatchIds: Set<string> | null;
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
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
  onSelect,
}: SceneCoreProps) {
  const terrainGeometry = useMemo(() => {
    const extent = Math.max(24, layout.radius * 2.05);
    const geometry = new PlaneGeometry(extent, extent, 32, 32);
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
        const spread = 12 + node.scale * 16;
        const influence = Math.exp(-distanceSquared / spread);
        height += influence * (node.position[1] * 0.12 + node.scale * 0.3);
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
        .slice(0, 9)
        .map((node) => node.id),
    );
  }, [layout.nodes, topology, visibleIds]);

  const selectedNode = selectedNoteId ? layout.nodeMap.get(selectedNoteId) ?? null : null;

  return (
    <>
      <group position={[0, -0.55, 0]}>
        <mesh geometry={terrainGeometry} receiveShadow>
          <meshStandardMaterial
            color={new Color('#0c2a35')}
            metalness={0.04}
            roughness={0.92}
            transparent
            opacity={0.42}
          />
        </mesh>
        <lineSegments geometry={terrainWireframe}>
          <lineBasicMaterial color="#7db5c5" transparent opacity={0.04} />
        </lineSegments>
      </group>

      {allEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[allEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#77b8cf" transparent opacity={0.08} />
        </lineSegments>
      ) : null}

      {selectedEdgePositions.length > 0 ? (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[selectedEdgePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#ffd08b" transparent opacity={0.58} />
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
            position={[node.position[0], node.position[1] + node.scale + 0.62, node.position[2]]}
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
          position={[selectedNode.position[0], selectedNode.position[1] + selectedNode.scale + 0.9, selectedNode.position[2]]}
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

      <CameraRig handSignalRef={handSignalRef} layout={layout} />
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
      <mesh scale={[radius * 3.2, radius * 0.12, radius * 3.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.65, 1, 32]} />
        <meshBasicMaterial color={selected ? '#ffd392' : node.color} transparent opacity={dimmed ? 0.05 : 0.26} />
      </mesh>
      <mesh scale={[1.68, 1.68, 1.68]}>
        <sphereGeometry args={[radius, 18, 18]} />
        <meshBasicMaterial
          color={selected ? '#ffd392' : node.color}
          transparent
          opacity={dimmed ? 0.03 : selected ? 0.24 : hovered ? 0.18 : 0.12}
        />
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
          emissiveIntensity={selected ? 1.5 : hovered ? 0.95 : isHub ? 0.72 : 0.52}
          transparent
          opacity={dimmed ? 0.18 : 0.98}
          roughness={0.16}
          metalness={0.08}
        />
      </mesh>
    </group>
  );
}

type CameraRigProps = {
  handSignalRef: React.MutableRefObject<HandNavigationSignal>;
  layout: ReturnType<typeof buildTopologyLayout>;
};

function CameraRig({ handSignalRef, layout }: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();

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

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

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
