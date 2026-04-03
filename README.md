# CerebroFinnie

3D topographical viewer for a local Obsidian vault, with hand-gesture navigation and full-note inspection.

## Setup

Install dependencies:

```bash
npm install
```

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
npm run build
npm run lint
```

## Retrieval model

The app does not read Obsidian through an API. It reads the vault directly from the local filesystem during the ingestion step.

Current pipeline:

1. Resolve the vault root from `CEREBRO_VAULT_PATH`, `cerebro.config.json`, or an enclosing folder that contains `.obsidian`
2. Walk the markdown files in that vault
3. Parse frontmatter, tags, aliases, wikilinks, excerpts, and full markdown
4. Generate `public/data/vault-graph.json`
5. Load that generated graph client-side in the viewer

`public/data/vault-graph.json` is ignored by git because it contains the note contents.

## Deployment modes

### Local development

- `npm run dev` requires local vault access
- it runs `npm run ingest` directly

### Remote builds like Vercel

`npm run build` now runs `npm run prepare-data`, which tries these sources in order:

1. local vault ingestion
2. existing `public/data/vault-graph.json`
3. `CEREBRO_SNAPSHOT_URL`

That means a Vercel deployment cannot read your laptop vault directly. It needs one of these:

- a committed snapshot file at `public/data/vault-graph.json`
- a remotely reachable snapshot URL in `CEREBRO_SNAPSHOT_URL`

Do not set `CEREBRO_VAULT_PATH` on Vercel to a local Windows path. The build machine cannot access your laptop filesystem.

## Main files

- `scripts/build-vault-graph.mjs`: local vault ingestion
- `src/App.tsx`: app shell and note selection state
- `src/components/BrainScene.tsx`: Three.js terrain and graph rendering
- `src/components/ControlHud.tsx`: search, grouping, and camera controls
- `src/components/NoteInspector.tsx`: side inspector
- `src/components/NoteModal.tsx`: full-note view
- `src/hooks/useHandNavigation.ts`: MediaPipe gesture control
- `docs/architecture.md`: architecture notes and future direction
