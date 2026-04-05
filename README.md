# CerebroFinnie

A 3D topographical knowledge graph viewer for Obsidian vaults — navigate your second brain as an interactive terrain map with hand-gesture controls and private mobile access.

## Why we built it

Obsidian is a powerful tool for building a personal knowledge base, but its built-in graph view is flat, hard to navigate at scale, and doesn't convey the relative weight or topology of your ideas. We wanted a way to *experience* a knowledge vault spatially — to see which notes are central, how clusters of thought form, and to literally reach into the graph and move through it.

CerebroFinnie turns a vault into a 3D landscape where note importance becomes elevation, link density becomes proximity, and topic clusters become visible terrain. Hand-gesture navigation lets you orbit, pan, zoom, and select notes without touching a keyboard. A private Supabase-backed runtime means you can explore your vault from your phone without ever exposing your notes publicly.

## Project breakdown

### Architecture at a glance

The project has two distinct layers:

1. **Ingestion** — a Node.js pipeline that reads an Obsidian vault from the local filesystem, parses every markdown note, resolves wikilinks into graph edges, computes importance scores, and emits a single `vault-graph.json` snapshot.
2. **Visualization** — a React + Three.js web app that consumes the snapshot and renders it as an interactive 3D scene with search, filtering, note inspection, and gesture-based camera control.

The browser never touches the filesystem directly. This separation keeps the runtime fast and makes deployment flexible — you can serve the snapshot locally, commit it, host it at a URL, or deliver it through an authenticated API.

### Ingestion pipeline

`scripts/build-vault-graph.mjs` is the retrieval boundary. It:

- Resolves the vault root from `CEREBRO_VAULT_PATH`, `cerebro.config.json`, or the nearest parent containing `.obsidian`
- Walks all markdown files, parsing frontmatter (tags, aliases, dates) and body content with `gray-matter`
- Extracts wikilinks and resolves them by path, basename, or alias into directed graph edges
- Computes an **importance score** for each note based on incoming links, outgoing links, tag count, and word count
- Reads Obsidian's `graph.json` color groups for cluster assignment
- Outputs `public/data/vault-graph.json` with full note metadata, edges, groups, and content

### 3D visualization

`src/components/BrainScene.tsx` renders the knowledge graph using Three.js via React Three Fiber:

- Notes appear as spheres — larger and higher for more important notes
- Edges connect linked notes as lines
- Color coding reflects folder or tag-based groups, with translucent glow overlays for clusters
- Click a node to inspect it; double-click to read the full note

### Three topology modes

The app offers three layout algorithms (in `src/lib/layouts.ts`) that arrange the graph differently:

| Mode | Concept | Layout |
|------|---------|--------|
| **Centralized** | Hub-and-spoke | Radiates outward from the highest-importance note |
| **Clustered** (default) | Force-directed grouping | Notes cluster by topic with organic spacing |
| **Distributed** | Flat peer network | Self-organizing layout emphasizing equal connectivity |

### Hand-gesture navigation

`src/hooks/useHandNavigation.ts` uses MediaPipe's gesture recognition model running entirely in the browser — no server inference required:

| Gesture | Action |
|---------|--------|
| Victory (V-hand) | Orbit the camera |
| Open palm | Pan the camera |
| Closed fist | Zoom in/out |
| Point up | Position cursor to select notes |
| Double-point | Open the selected note |

A camera overlay shows the video feed with hand landmarks, gesture confidence, and cursor position.

### Note inspection UI

- **Search bar** — full-text search across titles, paths, tags, and excerpts
- **Left panel** (`ControlHud.tsx`) — topology switcher, group/folder filters, matching notes list, graph stats
- **Right panel** (`NoteInspector.tsx`) — selected note metadata: importance score, link counts, word count, excerpt
- **Modal view** (`NoteModal.tsx`) — full rendered markdown with a toggle for raw source

### Private mobile access with Supabase

For on-the-go access without exposing your notes:

1. Run `npm run publish-snapshot` locally to upload the vault snapshot to a private Supabase Storage bucket
2. The deployed app presents a login screen (`AuthScreen.tsx`) using Supabase Auth (magic-link or password)
3. After sign-in, the app calls `/api/snapshot` — a serverless function that verifies the bearer token and streams the snapshot from private storage
4. The browser caches the snapshot locally for fast repeat access
5. An email allowlist in the API function restricts who can access the data

### Tech stack

- **React 19** with TypeScript
- **Three.js** / React Three Fiber / Drei for 3D rendering
- **MediaPipe Tasks Vision** for client-side hand tracking
- **Vite** for build tooling
- **Supabase** for auth and private storage
- **gray-matter** for frontmatter parsing
- **react-markdown** with remark-gfm for note rendering
- **Vercel** for deployment (serverless functions + static hosting)

## How it works end-to-end

### Local development

```
Obsidian vault on disk
        │
        ▼
  npm run dev
        │
        ├── runs build-vault-graph.mjs
        │       → parses notes, resolves links, computes scores
        │       → writes public/data/vault-graph.json
        │
        └── starts Vite dev server
                → browser loads vault-graph.json
                → renders 3D scene
                → user explores with mouse or hand gestures
```

### Remote deployment (Supabase mode)

```
Obsidian vault on disk
        │
        ▼
  npm run publish-snapshot
        │
        └── uploads vault-graph.json to private Supabase bucket

        ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

  User opens deployed app on phone/laptop
        │
        ├── Supabase Auth login (magic link)
        ├── App calls /api/snapshot with bearer token
        ├── Server verifies token, downloads from Supabase Storage
        ├── Browser receives and caches snapshot
        └── 3D scene renders with full vault data
```

## Setup

Install dependencies:

```bash
npm install
```

## Local vault mode

Point the app at your vault using one of these:

1. Set `CEREBRO_VAULT_PATH`
2. Copy `cerebro.config.example.json` to `cerebro.config.json` and edit `vaultPath`

Then run:

```bash
npm run dev
```

Useful commands:

```bash
npm run ingest             # Generate vault graph from local vault
npm run prepare-data       # Smart data prep for builds
npm run publish-snapshot   # Upload snapshot to Supabase Storage
npm run build              # Production build
npm run lint               # Run ESLint
```

## Private mobile mode with Supabase

Copy `.env.example` to `.env.local` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `VITE_CEREBRO_SITE_URL`
- optional `SUPABASE_SNAPSHOT_BUCKET`
- optional `SUPABASE_SNAPSHOT_PATH`
- optional `CEREBRO_ALLOWED_EMAIL`

Recommended Supabase setup:

1. Enable email auth and use magic-link login for your email
2. In Supabase Auth URL Configuration, set `Site URL` to your production CerebroFinnie URL instead of `http://localhost:3000`
3. Add redirect URLs for:
   - your production URL
   - your Vercel preview URL pattern
   - local development, such as `http://localhost:5173/**`
4. Keep the snapshot bucket private
5. Set the same env vars in Vercel for the deployed app
6. Run `npm run publish-snapshot` on your own machine whenever you want to refresh the remote snapshot

At runtime, the app signs in through Supabase Auth, calls `/api/snapshot`, and that server function verifies the Supabase bearer token before downloading the latest snapshot from private Storage.

## Retrieval model

The app does not read Obsidian through an API. It reads the vault directly from the local filesystem during the ingestion step.

Current pipeline:

1. Resolve the vault root from `CEREBRO_VAULT_PATH`, `cerebro.config.json`, or an enclosing folder that contains `.obsidian`
2. Walk the markdown files in that vault
3. Parse frontmatter, tags, aliases, wikilinks, excerpts, and full markdown
4. Generate `public/data/vault-graph.json`
5. Either load that generated graph client-side in the viewer, or upload it as a private snapshot for remote access

`public/data/vault-graph.json` is ignored by git because it contains the note contents.

## Deployment modes

### Local development

- `npm run dev` requires local vault access
- it runs `npm run ingest` directly

### Remote builds like Vercel

`npm run build` now runs `npm run prepare-data`, which behaves like this:

1. If `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present, it skips build-time snapshot work and expects runtime fetches from Supabase
2. Otherwise it tries local vault ingestion
3. Otherwise it uses an existing `public/data/vault-graph.json`
4. Otherwise it downloads from `CEREBRO_SNAPSHOT_URL`

That means a Vercel deployment cannot read your laptop vault directly. It needs one of these:

- a committed snapshot file at `public/data/vault-graph.json`
- a remotely reachable snapshot URL in `CEREBRO_SNAPSHOT_URL`
- or Supabase runtime mode enabled with the required env vars

Do not set `CEREBRO_VAULT_PATH` on Vercel to a local Windows path. The build machine cannot access your laptop filesystem.

## Main files

- `scripts/build-vault-graph.mjs` — local vault ingestion
- `scripts/publish-snapshot.mjs` — local publish step to private Supabase Storage
- `api/snapshot.js` — authenticated snapshot fetch for the deployed app
- `src/App.tsx` — app shell and note selection state
- `src/components/BrainScene.tsx` — Three.js terrain and graph rendering
- `src/components/ControlHud.tsx` — search, grouping, and camera controls
- `src/components/NoteInspector.tsx` — side inspector
- `src/components/NoteModal.tsx` — full-note view
- `src/components/AuthScreen.tsx` — Supabase login screen
- `src/hooks/useHandNavigation.ts` — MediaPipe gesture control
- `src/lib/layouts.ts` — topology layout algorithms
- `docs/architecture.md` — architecture notes and future direction
