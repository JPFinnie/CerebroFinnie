import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { BrainScene } from './components/BrainScene';
import { ControlHud } from './components/ControlHud';
import { NoteInspector } from './components/NoteInspector';
import { NoteModal } from './components/NoteModal';
import { useHandNavigation } from './hooks/useHandNavigation';
import type { TopologyMode, VaultGraph, VaultNote } from './types';
import './App.css';

function App() {
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [topology, setTopology] = useState<TopologyMode>('clustered');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [isFullNoteOpen, setIsFullNoteOpen] = useState(false);
  const deferredSearch = useDeferredValue(searchQuery);
  const handNavigation = useHandNavigation();

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      try {
        const response = await fetch('/data/vault-graph.json');
        if (!response.ok) {
          throw new Error(`Failed to load generated graph (${response.status})`);
        }

        const payload = (await response.json()) as VaultGraph;
        if (cancelled) {
          return;
        }

        setGraph(payload);
        setSelectedNoteId(payload.notes[0]?.id ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load graph data.');
        }
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, []);

  const noteLookup = useMemo(() => new Map(graph?.notes.map((note) => [note.id, note]) ?? []), [graph]);
  const selectedNote = selectedNoteId ? noteLookup.get(selectedNoteId) ?? null : null;

  const matchingNotes = useMemo(() => {
    if (!graph) {
      return [];
    }

    const base = activeGroup ? graph.notes.filter((note) => note.group === activeGroup) : graph.notes;
    const query = deferredSearch.trim().toLowerCase();

    if (!query) {
      return base.slice(0, 18);
    }

    return [...base]
      .filter((note) => createSearchHaystack(note).includes(query))
      .sort((left, right) => right.importance - left.importance || left.title.localeCompare(right.title));
  }, [activeGroup, deferredSearch, graph]);

  const searchMatchIds = useMemo(
    () => (deferredSearch.trim() ? new Set(matchingNotes.map((note) => note.id)) : null),
    [deferredSearch, matchingNotes],
  );

  const matchingCount = useMemo(() => {
    if (!graph) {
      return 0;
    }

    if (deferredSearch.trim()) {
      return matchingNotes.length;
    }

    if (activeGroup) {
      return graph.notes.filter((note) => note.group === activeGroup).length;
    }

    return graph.notes.length;
  }, [activeGroup, deferredSearch, graph, matchingNotes.length]);

  function handleTopologyChange(next: TopologyMode) {
    startTransition(() => {
      setTopology(next);
    });
  }

  function handleGroupChange(next: string | null) {
    startTransition(() => {
      setActiveGroup(next);
    });
  }

  function handleSelectNote(noteId: string) {
    startTransition(() => {
      setSelectedNoteId(noteId);
    });
  }

  function handleOpenFullNote() {
    setIsFullNoteOpen(true);
  }

  function handleCloseFullNote() {
    setIsFullNoteOpen(false);
  }

  function handleToggleCamera() {
    if (handNavigation.isRunning) {
      handNavigation.stop();
      return;
    }

    void handNavigation.start();
  }

  if (error) {
    return (
      <div className="loading-shell">
        <p className="eyebrow">Cerebro Atlas</p>
        <h1>Couldn't load the generated vault graph.</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="loading-shell">
        <p className="eyebrow">Cerebro Atlas</p>
        <h1>Loading your vault terrain...</h1>
        <p>Reading the generated note graph and preparing the 3D scene.</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="page-atmosphere" />

      <aside className="panel left-panel">
        <ControlHud
          topology={topology}
          activeGroup={activeGroup}
          groups={graph.groups}
          notes={matchingNotes}
          noteCount={graph.noteCount}
          edgeCount={graph.edgeCount}
          generatedAt={graph.generatedAt}
          searchQuery={searchQuery}
          selectedNoteId={selectedNoteId}
          matchingCount={matchingCount}
          videoRef={handNavigation.videoRef}
          handOverlay={handNavigation.overlay}
          isCameraRunning={handNavigation.isRunning}
          onSearchChange={setSearchQuery}
          onTopologyChange={handleTopologyChange}
          onGroupChange={handleGroupChange}
          onSelectNote={handleSelectNote}
          onToggleCamera={handleToggleCamera}
        />
      </aside>

      <main className="scene-panel">
        <BrainScene
          graph={graph}
          topology={topology}
          selectedNoteId={selectedNoteId}
          activeGroup={activeGroup}
          searchMatchIds={searchMatchIds}
          handSignalRef={handNavigation.commandRef}
          onSelect={handleSelectNote}
        />
      </main>

      <aside className="panel right-panel">
        <NoteInspector note={selectedNote} onOpenNote={handleOpenFullNote} />
      </aside>

      {selectedNote && isFullNoteOpen ? (
        <NoteModal key={selectedNote.id} note={selectedNote} onClose={handleCloseFullNote} />
      ) : null}
    </div>
  );
}

function createSearchHaystack(note: VaultNote) {
  return `${note.title} ${note.path} ${note.tags.join(' ')} ${note.excerpt}`.toLowerCase();
}

export default App;
