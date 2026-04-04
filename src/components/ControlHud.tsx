import { useState, type ChangeEvent } from 'react';
import type { TopologyMode, VaultGroup, VaultNote } from '../types';

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
  runtimeLabel?: string;
  sessionEmail?: string | null;
  onSearchChange: (value: string) => void;
  onTopologyChange: (next: TopologyMode) => void;
  onGroupChange: (next: string | null) => void;
  onSelectNote: (noteId: string) => void;
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
  runtimeLabel,
  sessionEmail,
  onSearchChange,
  onTopologyChange,
  onGroupChange,
  onSelectNote,
  onSignOut,
}: ControlHudProps) {
  const [isDisplayOpen, setIsDisplayOpen] = useState(true);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  return (
    <section className="control-shell">
      {/* Compact stats badge */}
      <div className="graph-stats-bar">
        <span className="graph-stat"><strong>{noteCount}</strong> notes</span>
        <span className="graph-stat-sep" />
        <span className="graph-stat"><strong>{edgeCount}</strong> links</span>
        <span className="graph-stat-sep" />
        <span className="graph-stat">{formatGeneratedAt(generatedAt)}</span>
      </div>

      {/* Display section — topology mode */}
      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setIsDisplayOpen((v) => !v)}
          aria-expanded={isDisplayOpen}
        >
          <span className="collapsible-arrow">{isDisplayOpen ? '▾' : '▸'}</span>
          <span className="mini-label">Display</span>
        </button>
        {isDisplayOpen && (
          <div className="collapsible-body">
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
          </div>
        )}
      </div>

      {/* Filters section — search + group chips */}
      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setIsFiltersOpen((v) => !v)}
          aria-expanded={isFiltersOpen}
        >
          <span className="collapsible-arrow">{isFiltersOpen ? '▾' : '▸'}</span>
          <span className="mini-label">Filters</span>
          {(searchQuery || activeGroup) && <span className="filter-active-dot" />}
        </button>
        {isFiltersOpen && (
          <div className="collapsible-body">
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
            {notes.length > 0 && (
              <div className="search-results">
                {notes.slice(0, 6).map((note) => (
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
            )}

            {/* Group color bands */}
            {groups.length > 0 && (
              <>
                <div className="group-header" style={{ marginTop: '0.5rem' }}>
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
              </>
            )}
          </div>
        )}
      </div>

      {/* Forces section — placeholder for future physics tuning */}
      <div className="collapsible-section">
        <div className="collapsible-header collapsible-header--disabled">
          <span className="collapsible-arrow">▸</span>
          <span className="mini-label" style={{ opacity: 0.45 }}>Forces</span>
          <span className="collapsible-coming-soon">soon</span>
        </div>
      </div>

      {/* Access / sign out */}
      {sessionEmail ? (
        <div className="access-shell">
          <p className="support-copy" style={{ fontSize: '0.76rem' }}>
            {sessionEmail}
            {runtimeLabel ? ` — ${runtimeLabel}` : ''}
          </p>
          {onSignOut ? (
            <button type="button" className="ghost-link" onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
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
