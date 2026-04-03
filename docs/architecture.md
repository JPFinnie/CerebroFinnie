# Architecture

## Current shape

CerebroFinnie is currently a local-first static viewer with a build-time ingestion step.

There are two distinct layers:

1. Ingestion
2. Visualization

### Ingestion

`scripts/build-vault-graph.mjs` is the retrieval boundary.

Its job is to:

- resolve a vault path
- scan markdown notes
- parse frontmatter and body content
- resolve Obsidian wikilinks into graph edges
- preserve both note excerpts and full markdown
- emit a single generated snapshot at `public/data/vault-graph.json`

This is intentionally simple and local-first. It gives full control and does not depend on Obsidian internals or third-party sync APIs.

### Visualization

The web app only consumes the generated snapshot. It does not walk the filesystem directly in the browser.

That keeps the runtime model clean:

- build/ingest step owns data access
- browser app owns layout, rendering, search, note inspection, and gesture input

## How note retrieval should work

The right architecture is a source-adapter model, even if only one adapter is implemented today.

Recommended abstraction:

- `LocalFilesystemVaultSource`
- `SnapshotVaultSource`
- `ApiVaultSource`

### 1. LocalFilesystemVaultSource

This is the current mode.

Use it when:

- the app runs on your own machine
- the vault is local
- full note access is required
- privacy matters more than easy deployment

Strengths:

- direct and fast
- no vendor dependency
- full-fidelity markdown and metadata

Weaknesses:

- cannot deploy remotely unless the build machine can access the vault
- absolute paths are user-specific

### 2. SnapshotVaultSource

This should be the next deployment-oriented mode.

Instead of reading the vault during app startup or remote build, a separate ingestion command would produce a sanitized or full snapshot artifact that the app reads later.

Use it when:

- you want to deploy the viewer somewhere you control
- you want a publish step between private notes and the app
- you want redaction or filtering before exposure

Recommended snapshot outputs:

- `vault-graph.json` for structure and metadata
- optional `vault-content.json` for full note bodies
- optional `semantic-index.json` for embeddings and cluster assignments

### 3. ApiVaultSource

This is the future option if you want live retrieval from a service.

Examples:

- local Node service with filesystem access
- Tauri desktop shell with native filesystem access
- authenticated private backend serving note data

Use it when:

- you want live updates without rebuilding snapshots
- you want controlled remote access
- you want user auth, permissions, or multi-device support

## Recommended near-term architecture

For your use case, the pragmatic architecture is:

1. Keep the viewer app in this repo
2. Keep the Obsidian vault as the source of truth
3. Use a local ingestion command to build a snapshot from the vault
4. Keep generated snapshots out of git by default
5. Add a publish mode later that exports a sanitized or encrypted snapshot

That gives you:

- full control
- no Obsidian lock-in
- a path to deployment without exposing the raw vault by accident

## Topology roadmap

The current topology engine is structural, not semantic.

To fully match the “three topologies” concept, add a semantic enrichment layer after ingestion:

1. Compute embeddings for each note
2. `centralized`: choose a semantic center and place notes by semantic distance
3. `decentralized`: cluster embeddings into theme hubs and place hubs on a Fibonacci sphere
4. `distributed`: build a semantic k-nearest-neighbor graph instead of using only explicit wikilinks

Recommended implementation split:

- `build-vault-graph.mjs`: structural ingest
- `build-semantic-topologies.mjs`: embeddings, clustering, nearest neighbors
- merged runtime snapshot consumed by the app

## Security stance

Because the generated snapshot currently contains full markdown, it should stay local unless you intentionally produce a publish-safe variant.

Before any remote deployment, define at least one of these:

- note allowlist
- tag-based visibility rules
- redaction rules
- encrypted private snapshot delivery
