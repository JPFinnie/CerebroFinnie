# CerebroFinnie

CerebroFinnie is a 3D knowledge graph viewer for Obsidian vaults. It turns a local Markdown vault into a private, topology-driven graph with Louvain communities, optional semantic edges, gesture navigation, and a public methodology guide at `https://cerebro-finnie.vercel.app/docs`.

## Why it exists

Obsidian's built-in graph is useful, but it gets hard to read once a vault grows. CerebroFinnie is meant to make the structure legible again:

- note importance becomes elevation
- edge density becomes proximity
- communities emerge from topology instead of folder names
- semantic relationships can be layered in on top of explicit wikilinks
- the same snapshot can be explored privately on desktop or mobile

The result is a viewer that treats a vault more like a map than a file tree.

## Architecture

The project has two layers:

1. Ingestion. A Node.js pipeline reads the vault from disk, parses Markdown, resolves links, imports optional semantic edges, detects communities, and writes a single snapshot file.
2. Visualization. A React + Three.js app reads that snapshot and renders it as an interactive 3D scene with search, filtering, note inspection, and hand-gesture controls.

The browser never reads the vault directly. That keeps deployment flexible: you can use a local snapshot, a remote snapshot URL, or private Supabase-backed runtime fetches.

## Ingestion pipeline

The main builder is [`scripts/build-vault-graph.mjs`](scripts/build-vault-graph.mjs). It:

- resolves the vault root from `CEREBRO_VAULT_PATH`, `cerebro.config.json`, or the nearest parent folder containing `.obsidian`
- walks all Markdown notes and parses frontmatter with `gray-matter`
- uses a SHA256 cache in `.cerebro-cache/` so unchanged files are not reparsed on every run
- resolves wikilinks by path, basename, or alias
- optionally imports graphify-style semantic edges from any `graphify-out/graph.json` found inside the vault
- synthesizes low-weight sibling edges for orphan-heavy folders so disconnected note runs still layout coherently
- runs Louvain community detection with `graphology` and `graphology-communities-louvain`
- applies Obsidian graph color groups only as explicit manual overrides on top of topology-based communities
- computes importance scores from incoming links, outgoing links, tag count, and word count
- writes `public/data/vault-graph.json`

Supporting scripts:

- [`scripts/import-graphify-edges.mjs`](scripts/import-graphify-edges.mjs): merges graphify-compatible semantic edges into the main graph
- [`scripts/generate-graphify-json.mjs`](scripts/generate-graphify-json.mjs): creates a graphify-compatible `graphify-out/graph.json` inside the vault using a repeatable title-reference plus TF-IDF similarity pass
- [`scripts/cache-manager.mjs`](scripts/cache-manager.mjs): content-hash cache helpers
- [`scripts/publish-snapshot.mjs`](scripts/publish-snapshot.mjs): uploads the latest snapshot to private Supabase Storage

## Visualization

The React app renders the snapshot with React Three Fiber and Drei:

- notes render as spheres
- edges render as lines
- topology communities drive color grouping by default
- search and filtering live in the HUD
- note details open in the inspector and modal
- MediaPipe hand gestures provide orbit, pan, zoom, and note selection

The app also includes a public docs page at `/docs`, rendered from [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) through [`src/pages/DocsPage.tsx`](src/pages/DocsPage.tsx).

## Semantic edges

Wikilinks only capture explicit note-to-note links. CerebroFinnie can also merge semantic edges when a compatible `graphify-out/graph.json` exists inside the vault.

There are two supported paths:

1. Repo-local bootstrap:

```bash
npm run generate-semantic-json
```

This writes `pm-brain-main/graphify-out/graph.json` inside the configured vault.

2. External graphify-compatible output:

- use the vendored graphify modules in [`tools/graphify`](tools/graphify)
- or drop in any compatible `graphify-out/graph.json` generated elsewhere

After semantic JSON exists, rebuild the snapshot:

```bash
node scripts/build-vault-graph.mjs
```

The importer tags those edges as `kind: "semantic"` and carries through `confidence` values.

## Public methodology docs

The standalone implementation guide is available in three forms:

- public URL: `https://cerebro-finnie.vercel.app/docs`
- Markdown source: [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md)
- PDF export: `npx md-to-pdf docs/METHODOLOGY.md`

The docs are meant for colleagues who need to reproduce the system without GitHub access.

## Setup

Install dependencies:

```bash
npm install
```

Point the repo at your vault with either:

1. `CEREBRO_VAULT_PATH`
2. a local `cerebro.config.json`

Example config:

```json
{
  "vaultPath": "../../CerebroAtlas",
  "excludeDirectories": [".cursor"],
  "excludeFiles": ["03-Snapshots.md"]
}
```

## Common commands

```bash
npm run ingest                  # Build public/data/vault-graph.json from the local vault
npm run generate-semantic-json # Write graphify-compatible semantic JSON into the vault
npm run prepare-data           # Build-time snapshot preparation for production builds
npm run publish-snapshot       # Upload snapshot to private Supabase Storage
npm run dev                    # Local dev server
npm run build                  # Production build
npm run lint                   # ESLint
```

## End-to-end flow

### Local development

```text
Obsidian vault on disk
        |
        v
  npm run dev
        |
        +-- build-vault-graph.mjs
        |     -> parse notes
        |     -> resolve links
        |     -> merge optional semantic edges
        |     -> detect communities
        |     -> write public/data/vault-graph.json
        |
        +-- start Vite dev server
              -> browser loads snapshot
              -> renders 3D scene
```

### Private remote access

```text
Obsidian vault on disk
        |
        v
  npm run publish-snapshot
        |
        +-- upload latest snapshot to private Supabase bucket

  User opens deployed app
        |
        +-- sign in with Supabase Auth
        +-- app calls /api/snapshot
        +-- server verifies bearer token
        +-- snapshot is streamed from private storage
        +-- browser caches and renders the graph
```

## Supabase runtime mode

For private mobile access, set these environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_CEREBRO_SITE_URL`
- optional `SUPABASE_SNAPSHOT_BUCKET`
- optional `SUPABASE_SNAPSHOT_PATH`
- optional `CEREBRO_ALLOWED_EMAIL`

Recommended setup:

1. Enable email auth in Supabase.
2. Keep the snapshot bucket private.
3. Set the same env vars in Vercel for the deployed app.
4. Run `npm run publish-snapshot` from your own machine whenever you want to refresh the live private snapshot.

The authenticated runtime endpoint is [`api/snapshot.js`](api/snapshot.js).

## Deployment notes

`npm run build` runs `npm run prepare-data` first. The build behaves like this:

1. If Supabase runtime env vars are present, it skips local vault ingestion and expects runtime snapshot fetches.
2. Otherwise it tries local vault ingestion.
3. Otherwise it uses an existing `public/data/vault-graph.json`.
4. Otherwise it downloads from `CEREBRO_SNAPSHOT_URL`.

That means hosted builds cannot read a local Windows vault path directly. For Vercel, use a prepared snapshot or Supabase runtime mode.

The repo includes [`vercel.json`](vercel.json) with a filesystem-first SPA fallback so `/docs` works without breaking static assets or API routes.

## Tech stack

- React 19
- TypeScript
- Vite
- Three.js
- React Three Fiber
- Drei
- MediaPipe Tasks Vision
- Supabase
- graphology
- graphology-communities-louvain
- gray-matter
- react-markdown
- remark-gfm
- Vercel

## Main files

- [`scripts/build-vault-graph.mjs`](scripts/build-vault-graph.mjs)
- [`scripts/import-graphify-edges.mjs`](scripts/import-graphify-edges.mjs)
- [`scripts/generate-graphify-json.mjs`](scripts/generate-graphify-json.mjs)
- [`scripts/cache-manager.mjs`](scripts/cache-manager.mjs)
- [`scripts/publish-snapshot.mjs`](scripts/publish-snapshot.mjs)
- [`api/snapshot.js`](api/snapshot.js)
- [`src/App.tsx`](src/App.tsx)
- [`src/components/BrainScene.tsx`](src/components/BrainScene.tsx)
- [`src/components/ControlHud.tsx`](src/components/ControlHud.tsx)
- [`src/components/NoteInspector.tsx`](src/components/NoteInspector.tsx)
- [`src/components/NoteModal.tsx`](src/components/NoteModal.tsx)
- [`src/components/AboutModal.tsx`](src/components/AboutModal.tsx)
- [`src/hooks/useHandNavigation.ts`](src/hooks/useHandNavigation.ts)
- [`src/pages/DocsPage.tsx`](src/pages/DocsPage.tsx)
- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md)
- [`tools/graphify`](tools/graphify)
