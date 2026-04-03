# CerebroFinnie

3D topographical viewer for an Obsidian vault, with hand-gesture navigation, full-note inspection, and a private Supabase-backed mobile runtime.

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
npm run ingest
npm run prepare-data
npm run publish-snapshot
npm run build
npm run lint
```

## Private mobile mode with Supabase

Copy `.env.example` to `.env.local` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- optional `SUPABASE_SNAPSHOT_BUCKET`
- optional `SUPABASE_SNAPSHOT_PATH`
- optional `CEREBRO_ALLOWED_EMAIL`

Recommended Supabase setup:

1. Enable email auth and use magic-link login for `james_finnie@icloud.com`
2. Keep the snapshot bucket private
3. Set the same env vars in Vercel for the deployed app
4. Run `npm run publish-snapshot` on your own machine whenever you want to refresh the remote snapshot

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

- `scripts/build-vault-graph.mjs`: local vault ingestion
- `scripts/publish-snapshot.mjs`: local publish step to private Supabase Storage
- `api/snapshot.js`: authenticated snapshot fetch for the deployed app
- `src/App.tsx`: app shell and note selection state
- `src/components/BrainScene.tsx`: Three.js terrain and graph rendering
- `src/components/ControlHud.tsx`: search, grouping, and camera controls
- `src/components/NoteInspector.tsx`: side inspector
- `src/components/NoteModal.tsx`: full-note view
- `src/components/AuthScreen.tsx`: Supabase login screen
- `src/hooks/useHandNavigation.ts`: MediaPipe gesture control
- `docs/architecture.md`: architecture notes and future direction
