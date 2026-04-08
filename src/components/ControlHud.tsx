import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
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
  clustered: 'Communities settle into a volumetric memory field.',
  distributed: 'Links self-organize into a flatter, more democratic cloud.',
};

const VISIBLE_NOTE_LIMIT = 8;

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
  const [isFiltersOpen, setIsFiltersOpen] = useState(true);
  const [groupQuery, setGroupQuery] = useState('');

  const visibleNotes = useMemo(() => notes.slice(0, VISIBLE_NOTE_LIMIT), [notes]);
  const filteredGroups = useMemo(() => {
    const query = groupQuery.trim().toLowerCase();
    if (!query) {
      return groups;
    }

    return groups.filter((group) => `${group.label} ${group.key}`.toLowerCase().includes(query));
  }, [groupQuery, groups]);

  const hasActiveFilters = Boolean(searchQuery.trim() || activeGroup);

  return (
    <section className="control-shell">
      <div className="graph-stats-bar">
        <span className="graph-stat"><strong>{noteCount}</strong> notes</span>
        <span className="graph-stat-sep" />
        <span className="graph-stat"><strong>{edgeCount}</strong> links</span>
        <span className="graph-stat-sep" />
        <span className="graph-stat">{formatGeneratedAt(generatedAt)}</span>
      </div>

      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setIsDisplayOpen((value) => !value)}
          aria-expanded={isDisplayOpen}
        >
          <span className="collapsible-arrow">{isDisplayOpen ? '▾' : '▸'}</span>
          <span className="mini-label">Layout</span>
        </button>
        {isDisplayOpen ? (
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
        ) : null}
      </div>

      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setIsFiltersOpen((value) => !value)}
          aria-expanded={isFiltersOpen}
        >
          <span className="collapsible-arrow">{isFiltersOpen ? '▾' : '▸'}</span>
          <span className="mini-label">Filters</span>
          {hasActiveFilters ? <span className="filter-active-dot" /> : null}
        </button>
        {isFiltersOpen ? (
          <div className="collapsible-body">
            <div className="filter-block">
              <div className="group-header">
                <p className="mini-label">Active filters</p>
                <button
                  type="button"
                  className={hasActiveFilters ? 'ghost-link active' : 'ghost-link'}
                  onClick={() => {
                    onSearchChange('');
                    onGroupChange(null);
                  }}
                  disabled={!hasActiveFilters}
                >
                  Clear all
                </button>
              </div>

              {hasActiveFilters ? (
                <div className="filter-pill-row">
                  {searchQuery.trim() ? (
                    <button
                      type="button"
                      className="filter-pill"
                      onClick={() => onSearchChange('')}
                    >
                      Search: {truncate(searchQuery.trim(), 22)} ×
                    </button>
                  ) : null}
                  {activeGroup ? (
                    <button
                      type="button"
                      className="filter-pill"
                      onClick={() => onGroupChange(null)}
                    >
                      {truncate(activeGroup, 24)} ×
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="support-copy">
                  Use the top search bar, then narrow the atlas by color band here.
                </p>
              )}
            </div>

            <div className="filter-block">
              <div className="group-header">
                <p className="mini-label">Matching notes</p>
                <span className="group-meta">{matchingCount} visible</span>
              </div>
              {visibleNotes.length > 0 ? (
                <div className="search-results search-results--stacked">
                  {visibleNotes.map((note) => (
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
              ) : (
                <p className="support-copy">No notes match the current search and group filters.</p>
              )}
            </div>

            <div className="filter-block">
              <div className="group-header">
                <p className="mini-label">Color bands</p>
                <span className="group-meta">{filteredGroups.length} / {groups.length}</span>
              </div>
              <input
                className="search-input search-input--compact"
                type="search"
                value={groupQuery}
                placeholder="Filter color bands..."
                onChange={(event: ChangeEvent<HTMLInputElement>) => setGroupQuery(event.target.value)}
              />
              <div className="group-list group-list--stacked">
                <button
                  type="button"
                  className={activeGroup === null ? 'group-chip group-chip--row active' : 'group-chip group-chip--row'}
                  onClick={() => onGroupChange(null)}
                >
                  <span className="swatch swatch--all" />
                  <span>All groups</span>
                  <span>{noteCount}</span>
                </button>

                {filteredGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    className={group.key === activeGroup ? 'group-chip group-chip--row active' : 'group-chip group-chip--row'}
                    onClick={() => onGroupChange(group.key === activeGroup ? null : group.key)}
                  >
                    <span className="swatch" style={{ backgroundColor: group.color }} />
                    <span>{group.label}</span>
                    <span>{group.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {sessionEmail ? (
        <div className="access-shell">
          <p className="support-copy access-shell-copy">
            {sessionEmail}
            {runtimeLabel ? ` - ${runtimeLabel}` : ''}
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

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
