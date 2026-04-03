import type { ChangeEvent, RefObject } from 'react';
import type { HandOverlayState, TopologyMode, VaultGroup, VaultNote } from '../types';

type ControlHudProps = {
  topology: TopologyMode;
  activeGroup: string | null;
  groups: VaultGroup[];
  notes: VaultNote[];
  noteCount: number;
  edgeCount: number;
  generatedAt: string;
  searchQuery: string;
  selectedNoteId: string | null;
  matchingCount: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  handOverlay: HandOverlayState;
  isCameraRunning: boolean;
  runtimeLabel?: string;
  sessionEmail?: string | null;
  onSearchChange: (value: string) => void;
  onTopologyChange: (next: TopologyMode) => void;
  onGroupChange: (next: string | null) => void;
  onSelectNote: (noteId: string) => void;
  onToggleCamera: () => void;
  onSignOut?: () => void;
};

const TOPOLOGY_COPY: Record<TopologyMode, string> = {
  centralized: 'Everything radiates from the strongest note hub.',
  clustered: 'Themes settle into topic islands with local gravity.',
  distributed: 'Links self-organize into a flatter memory field.',
};

export function ControlHud({
  topology,
  activeGroup,
  groups,
  notes,
  noteCount,
  edgeCount,
  generatedAt,
  searchQuery,
  selectedNoteId,
  matchingCount,
  videoRef,
  handOverlay,
  isCameraRunning,
  runtimeLabel,
  sessionEmail,
  onSearchChange,
  onTopologyChange,
  onGroupChange,
  onSelectNote,
  onToggleCamera,
  onSignOut,
}: ControlHudProps) {
  return (
    <section className="control-shell">
      <div className="brand-block">
        <p className="eyebrow">Cerebro Atlas</p>
        <h1>Topographical viewer for your Obsidian brain.</h1>
        <p className="lede">
          A local terrain renderer over your actual vault graph, with camera hand tracking layered on top.
        </p>
      </div>

      {sessionEmail ? (
        <section className="access-shell">
          <div className="group-header">
            <div>
              <p className="mini-label">Access</p>
              <p className="support-copy">
                Signed in as {sessionEmail}. {runtimeLabel ?? 'Private snapshot runtime is active.'}
              </p>
            </div>
            {onSignOut ? (
              <button type="button" className="ghost-link" onClick={onSignOut}>
                Sign out
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <dl className="hero-metrics">
        <div>
          <dt>Notes</dt>
          <dd>{noteCount}</dd>
        </div>
        <div>
          <dt>Links</dt>
          <dd>{edgeCount}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatGeneratedAt(generatedAt)}</dd>
        </div>
      </dl>

      <section className="topology-shell">
        <p className="mini-label">Topology</p>
        <div className="topology-switch">
          {(['centralized', 'clustered', 'distributed'] as TopologyMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={mode === topology ? 'mode-button active' : 'mode-button'}
              onClick={() => onTopologyChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="support-copy">{TOPOLOGY_COPY[topology]}</p>
      </section>

      <section className="search-shell">
        <label className="mini-label" htmlFor="note-search">
          Search notes
        </label>
        <input
          id="note-search"
          className="search-input"
          type="search"
          value={searchQuery}
          placeholder="Find people, projects, prompts..."
          onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)}
        />
        <p className="support-copy">
          {searchQuery ? `${matchingCount} matches in the current vault.` : 'Search by title, path, tag, or excerpt.'}
        </p>
        <div className="search-results">
          {notes.slice(0, 10).map((note) => (
            <button
              key={note.id}
              type="button"
              className={note.id === selectedNoteId ? 'result-button active' : 'result-button'}
              onClick={() => onSelectNote(note.id)}
            >
              <span>{note.title}</span>
              <span>{note.path}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="group-shell">
        <div className="group-header">
          <p className="mini-label">Color bands</p>
          <button
            type="button"
            className={activeGroup === null ? 'ghost-link active' : 'ghost-link'}
            onClick={() => onGroupChange(null)}
          >
            All groups
          </button>
        </div>
        <div className="group-list">
          {groups.slice(0, 14).map((group) => (
            <button
              key={group.key}
              type="button"
              className={group.key === activeGroup ? 'group-chip active' : 'group-chip'}
              onClick={() => onGroupChange(group.key === activeGroup ? null : group.key)}
            >
              <span className="swatch" style={{ backgroundColor: group.color }} />
              <span>{group.label}</span>
              <span>{group.count}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="camera-shell">
        <div className="camera-header">
          <div>
            <p className="mini-label">Hand navigation</p>
            <p className="support-copy">{handOverlay.message}</p>
          </div>
          <button type="button" className="camera-button" onClick={onToggleCamera}>
            {isCameraRunning ? 'Stop camera' : 'Start camera'}
          </button>
        </div>

        <div className={isCameraRunning ? 'camera-preview live' : 'camera-preview'}>
          <video ref={videoRef} autoPlay muted playsInline />
          {handOverlay.cursor ? (
            <span
              className="gesture-cursor"
              style={{
                left: `${handOverlay.cursor.x * 100}%`,
                top: `${handOverlay.cursor.y * 100}%`,
              }}
            />
          ) : null}
          <div className="camera-status">
            <span className={`status-dot ${handOverlay.status}`} />
            <span>{handOverlay.status}</span>
          </div>
        </div>

        <p className="support-copy camera-tip">
          Use a single-hand Victory sign. Move left/right to orbit, up/down to tilt, and widen or narrow finger
          spacing to zoom.
        </p>
      </section>
    </section>
  );
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
