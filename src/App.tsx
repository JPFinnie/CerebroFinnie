import type { Session } from '@supabase/supabase-js';
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import './App.css';
import { AuthScreen } from './components/AuthScreen';
import { BrainScene } from './components/BrainScene';
import { ControlHud } from './components/ControlHud';
import { NoteInspector } from './components/NoteInspector';
import { NoteModal } from './components/NoteModal';
import { useHandNavigation } from './hooks/useHandNavigation';
import { clearCachedSnapshot, readCachedSnapshot, writeCachedSnapshot } from './lib/snapshot-cache';
import { defaultLoginEmail, defaultLoginPassword, isSupabaseRuntimeEnabled, supabase } from './lib/supabase';
import type { TopologyMode, VaultGraph, VaultNote } from './types';
import type { ChangeEvent } from 'react';

const LOCAL_RUNTIME_LABEL = 'Viewing the locally generated vault snapshot.';
const REMOTE_RUNTIME_LABEL = 'Viewing the latest private snapshot from Supabase.';
const REMOTE_CACHE_LABEL = 'Using the last cached snapshot because the live fetch failed.';

function App() {
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [topology, setTopology] = useState<TopologyMode>('clustered');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [isFullNoteOpen, setIsFullNoteOpen] = useState(false);
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(false);
  const [isInspectorPanelOpen, setIsInspectorPanelOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(!isSupabaseRuntimeEnabled);
  const [isGraphLoading, setIsGraphLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState(defaultLoginEmail);
  const [loginPassword, setLoginPassword] = useState(defaultLoginPassword);
  const [isSendingLink, setIsSendingLink] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [runtimeLabel, setRuntimeLabel] = useState(LOCAL_RUNTIME_LABEL);
  const deferredSearch = useDeferredValue(searchQuery);
  const handNavigation = useHandNavigation();

  useEffect(() => {
    if (!isSupabaseRuntimeEnabled || !supabase) {
      setIsAuthReady(true);
      return;
    }

    let cancelled = false;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!cancelled) {
        setSession(nextSession);
      }
    });

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (cancelled) {
          return;
        }

        if (sessionError) {
          setError(sessionError.message);
        }

        setSession(data.session ?? null);
        setIsAuthReady(true);
      })
      .catch((sessionError: unknown) => {
        if (!cancelled) {
          setError(sessionError instanceof Error ? sessionError.message : 'Unable to initialize Supabase auth.');
          setIsAuthReady(true);
        }
      });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isSupabaseRuntimeEnabled && !isAuthReady) {
      return;
    }

    let cancelled = false;

    async function loadGraph() {
      if (isSupabaseRuntimeEnabled && !session) {
        if (!cancelled) {
          setGraph(null);
          setSelectedNoteId(null);
          setIsGraphLoading(false);
          setRuntimeLabel(REMOTE_RUNTIME_LABEL);
        }
        return;
      }

      setError(null);
      setIsGraphLoading(true);

      try {
        if (!isSupabaseRuntimeEnabled) {
          const payload = await fetchLocalGraph();
          if (cancelled) {
            return;
          }

          applyGraph(payload, setGraph, setSelectedNoteId);
          setRuntimeLabel(LOCAL_RUNTIME_LABEL);
          return;
        }

        const accessToken = await getAccessToken(session);
        const payload = await fetchRemoteGraph(accessToken);
        if (cancelled) {
          return;
        }

        applyGraph(payload, setGraph, setSelectedNoteId);
        writeCachedSnapshot(payload);
        setRuntimeLabel(REMOTE_RUNTIME_LABEL);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        const cachedSnapshot = isSupabaseRuntimeEnabled ? readCachedSnapshot() : null;
        if (cachedSnapshot) {
          applyGraph(cachedSnapshot, setGraph, setSelectedNoteId);
          setRuntimeLabel(REMOTE_CACHE_LABEL);
          setError(null);
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Unable to load graph data.');
      } finally {
        if (!cancelled) {
          setIsGraphLoading(false);
        }
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [isAuthReady, session]);

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
      setIsInspectorPanelOpen(true);
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

  async function handleSignIn() {
    if (!supabase) {
      setAuthMessage('Supabase runtime mode is not configured.');
      return;
    }

    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    if (!email) {
      setAuthMessage('Enter an email address.');
      return;
    }
    if (!password) {
      setAuthMessage('Enter a password.');
      return;
    }

    setIsSendingLink(true);
    setAuthMessage(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setIsSendingLink(false);

    if (signInError) {
      setAuthMessage(signInError.message);
      return;
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      return;
    }

    clearCachedSnapshot();
    setGraph(null);
    setSelectedNoteId(null);
    setAuthMessage('Signed out.');
  }

  if (isSupabaseRuntimeEnabled && !isAuthReady) {
    return (
      <div className="loading-shell">
        <p className="eyebrow">Cerebro Atlas</p>
        <h1>Connecting to Supabase...</h1>
        <p>Restoring your private session and preparing the latest snapshot.</p>
      </div>
    );
  }

  if (isSupabaseRuntimeEnabled && !session) {
    return (
      <AuthScreen
        email={loginEmail}
        password={loginPassword}
        isSubmitting={isSendingLink}
        message={error ?? authMessage}
        onEmailChange={setLoginEmail}
        onPasswordChange={setLoginPassword}
        onSignIn={handleSignIn}
      />
    );
  }

  if (error && !graph) {
    return (
      <div className="loading-shell">
        <p className="eyebrow">Cerebro Atlas</p>
        <h1>Couldn't load the generated vault graph.</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (isGraphLoading || !graph) {
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

      <header className="header-bar">
        <div className="header-brand">
          <p className="eyebrow">Cerebro Atlas</p>
          <div className="header-brand-copy">
            <strong>Neural knowledge map</strong>
            <span>{runtimeLabel}</span>
          </div>
        </div>

        <dl className="header-stats" aria-label="Vault stats">
          <div>
            <dt>Notes</dt>
            <dd>{graph.noteCount}</dd>
          </div>
          <div>
            <dt>Links</dt>
            <dd>{graph.edgeCount}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatGeneratedAt(graph.generatedAt)}</dd>
          </div>
        </dl>

        <label className="header-search" htmlFor="header-note-search">
          <span className="mini-label">{searchQuery ? `${matchingCount} matches` : 'Search'}</span>
          <input
            id="header-note-search"
            className="search-input header-search-input"
            type="search"
            value={searchQuery}
            placeholder="Search notes, tags, people, projects..."
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
          />
        </label>

        <div className="header-actions">
          <button
            type="button"
            className={isControlPanelOpen ? 'panel-toggle active' : 'panel-toggle'}
            onClick={() => setIsControlPanelOpen((current) => !current)}
          >
            {isControlPanelOpen ? 'Hide Controls' : 'Show Controls'}
          </button>
          <button
            type="button"
            className={isInspectorPanelOpen ? 'panel-toggle active' : 'panel-toggle'}
            onClick={() => setIsInspectorPanelOpen((current) => !current)}
          >
            {isInspectorPanelOpen ? 'Hide Note' : 'Show Note'}
          </button>
        </div>
      </header>

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

      {isControlPanelOpen ? (
        <aside className="panel left-panel overlay-panel">
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
            runtimeLabel={runtimeLabel}
            sessionEmail={session?.user.email ?? null}
            onSearchChange={setSearchQuery}
            onTopologyChange={handleTopologyChange}
            onGroupChange={handleGroupChange}
            onSelectNote={handleSelectNote}
            onToggleCamera={handleToggleCamera}
            onSignOut={isSupabaseRuntimeEnabled ? handleSignOut : undefined}
          />
        </aside>
      ) : null}

      {isInspectorPanelOpen ? (
        <aside className="panel right-panel overlay-panel">
          <NoteInspector note={selectedNote} onOpenNote={handleOpenFullNote} />
        </aside>
      ) : null}

      {selectedNote && isFullNoteOpen ? (
        <NoteModal key={selectedNote.id} note={selectedNote} onClose={handleCloseFullNote} />
      ) : null}
    </div>
  );
}

function applyGraph(
  payload: VaultGraph,
  setGraph: (value: VaultGraph) => void,
  setSelectedNoteId: (value: string | null | ((current: string | null) => string | null)) => void,
) {
  setGraph(payload);
  setSelectedNoteId((current) => {
    if (current && payload.notes.some((note) => note.id === current)) {
      return current;
    }

    return null;
  });
}

async function fetchLocalGraph() {
  const response = await fetch('/data/vault-graph.json');
  if (!response.ok) {
    throw new Error(`Failed to load generated graph (${response.status})`);
  }

  return (await response.json()) as VaultGraph;
}

async function fetchRemoteGraph(accessToken: string) {
  const response = await fetch('/api/snapshot', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Failed to load Supabase snapshot (${response.status})`));
  }

  return (await response.json()) as VaultGraph;
}

async function getAccessToken(session: Session | null) {
  if (!supabase) {
    throw new Error('Supabase runtime mode is not configured.');
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  const accessToken = data.session?.access_token ?? session?.access_token;
  if (!accessToken) {
    throw new Error('Supabase session is missing an access token.');
  }

  return accessToken;
}

async function readErrorMessage(response: Response, fallbackMessage: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

function createSearchHaystack(note: VaultNote) {
  return `${note.title} ${note.path} ${note.tags.join(' ')} ${note.excerpt}`.toLowerCase();
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

export default App;
