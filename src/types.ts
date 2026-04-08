import type { MutableRefObject } from 'react';

export interface VaultGroup {
  key: string;
  label: string;
  color: string;
  count: number;
}

export interface VaultNote {
  id: string;
  title: string;
  path: string;
  folder: string;
  aliases: string[];
  tags: string[];
  excerpt: string;
  markdown: string;
  fullMarkdown: string;
  wordCount: number;
  updated: string | null;
  outgoing: string[];
  incomingCount: number;
  outgoingCount: number;
  degree: number;
  group: string;
  color: string;
  importance: number;
}

export interface VaultEdge {
  source: string;
  target: string;
  weight: number;
  /** Edge origin: wikilink = explicit [[link]], semantic = LLM-extracted (graphify), sibling = synthetic folder chain */
  kind?: 'wikilink' | 'semantic' | 'sibling';
  /** Graphify confidence label for semantic edges */
  confidence?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  /** Graphify relation type for semantic edges (e.g. 'semantically_similar_to', 'references') */
  relation?: string;
}

export interface VaultGraph {
  generatedAt: string;
  vaultRoot: string;
  noteCount: number;
  edgeCount: number;
  groups: VaultGroup[];
  notes: VaultNote[];
  edges: VaultEdge[];
}

export type TopologyMode = 'centralized' | 'clustered' | 'distributed';

export type ZoomTier = 'atlas' | 'explore' | 'close';

export interface LayoutNode extends VaultNote {
  position: [number, number, number];
  scale: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  nodeMap: Map<string, LayoutNode>;
  radius: number;
  hubNoteId: string | null;
  center: [number, number, number];
}

export interface HandNavigationSignal {
  active: boolean;
  deltaAzimuth: number;
  deltaPolar: number;
  zoomDelta: number;
  panDelta: { x: number; y: number };
  cursor: { x: number; y: number };
  separation: number;
  gestureTrigger: { type: 'select' | 'open'; cursor: { x: number; y: number } } | null;
}

export type HandStatus = 'idle' | 'loading' | 'ready' | 'active' | 'error';

export interface HandOverlayState {
  status: HandStatus;
  message: string;
  cursor: { x: number; y: number } | null;
  separation: number;
  landmarks?: { x: number; y: number; z: number }[][];
  gestureLabel?: string;
}

export interface HandNavigationController {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  commandRef: MutableRefObject<HandNavigationSignal>;
  overlay: HandOverlayState;
  isRunning: boolean;
  isPaused: boolean;
  start: () => Promise<void>;
  stop: () => void;
  togglePause: () => void;
}
