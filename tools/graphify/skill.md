# /graphify

Run the vendored `graphify` package from this repository so semantic edges can be merged into the
CerebroFinnie graph build without installing anything from GitHub.

## Setup

```bash
cd tools/graphify
pip install -r requirements.txt
```

## Supported run path

```bash
/graphify C:/Users/james/Desktop/CerebroAtlas/pm-brain-main
```

The vendored package in this repo contains the graphify modules plus the repo-local skill trigger.
In this revision, the direct `python -m graphify` entrypoint exposes install/query helpers, while
the end-to-end semantic extraction flow is still the skill-driven `/graphify` workflow.

That workflow writes `graphify-out/graph.json` inside the scanned folder. Rebuild the viewer graph
afterward:

```bash
node scripts/build-vault-graph.mjs
```

If you need a repo-local bootstrap without the external skill runtime, generate a compatible
semantic file directly from the current Cerebro snapshot:

```bash
npm run generate-semantic-json
```

That writes `pm-brain-main/graphify-out/graph.json` in the active vault so the next graph build can
merge those semantic edges immediately.

The Node build automatically imports the generated semantic edges through
`scripts/import-graphify-edges.mjs`.

If you already have a compatible `graphify-out/graph.json` from another graphify-capable
environment, you can drop it into the vault and rebuild; CerebroFinnie will import it
automatically.
