# CerebroFinnie - Claude Code guide

CerebroFinnie is a React 19 + Three.js (react-three/fiber) 3D knowledge-graph viewer for
Obsidian vaults. The build pipeline reads markdown, extracts wikilinks, runs Louvain community
detection, and optionally merges LLM-extracted semantic edges from graphify.

## Key scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `node scripts/build-vault-graph.mjs` | Rebuild `vault-graph.json` from the vault |
| `node --env-file=.env scripts/publish-snapshot.mjs` | Push the latest snapshot to Supabase |
| `npm run build` | TypeScript check plus Vite production build |

## Vault path

Configured in `cerebro.config.json -> vaultPath` (relative to repo root, or absolute).
Current target: `../../CerebroAtlas`.

## Graphify - semantic edge extraction

Graphify is vendored in `tools/graphify/`. It performs a two-pass extraction (deterministic
AST + LLM semantic pass) on any folder and emits a `graphify-out/graph.json` that the build
script automatically picks up.

**Setup:**
```bash
cd tools/graphify
pip install -r requirements.txt
```

**Generate semantic edges:**
```bash
/graphify C:/Users/james/Desktop/CerebroAtlas/pm-brain-main
# -> writes pm-brain-main/graphify-out/graph.json in a skill-aware agent environment
node scripts/build-vault-graph.mjs   # picks up semantic edges automatically
```

The vendored `python -m graphify` entrypoint currently exposes install/query helpers; the
end-to-end semantic extraction run path in this repo is the `/graphify` skill workflow or a
compatible pre-generated `graphify-out/graph.json`.

**Repo-local launcher skill:** see `tools/graphify/skill.md`
**Full upstream skill reference:** see `tools/graphify/graphify/skill.md`

@tools/graphify/skill.md
