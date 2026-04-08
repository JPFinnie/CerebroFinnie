/**
 * import-graphify-edges.mjs
 *
 * Reads the graphify output (graphify-out/graph.json) from anywhere inside the
 * vault tree and maps graphify's node IDs back to CerebroFinnie note IDs via
 * source_file path matching.
 *
 * graphify produces edges tagged as:
 *   confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
 *   relation:   'semantically_similar_to' | 'references' | 'uses' | 'calls' | ...
 *
 * We emit these as kind: 'semantic' edges so the viewer (and Louvain) can treat
 * them differently from wikilinks and sibling chains.
 *
 * Usage (automatic — called by build-vault-graph.mjs):
 *   No graphify output? Returns [] silently.
 *   Graphify output present? Returns merged semantic edge list.
 *
 * To generate graphify output, run in Claude Code:
 *   /graphify C:/path/to/vault/pm-brain-main
 *   (or: python -m graphify <path> from tools/graphify/)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Scan the vault tree for any graphify-out/graph.json files, then merge
 * the semantic edges from each into CerebroFinnie's edge format.
 *
 * @param {string} vaultRoot - Absolute path to the Obsidian vault root
 * @param {Array<{id: string, path: string}>} notes - CerebroFinnie notes array
 * @param {Set<string>} seenEdges - Already-seen edge keys to prevent duplicates
 * @returns {Promise<Array>} Semantic edges ready to push into resolvedEdges
 */
export async function importGraphifyEdges(vaultRoot, notes, seenEdges) {
  const graphifyFiles = await findGraphifyOutputs(vaultRoot);
  if (graphifyFiles.length === 0) {
    return [];
  }

  // Build a lookup from source_file (relative to vault root) → note id
  const pathToNoteId = new Map();
  for (const note of notes) {
    // note.path is already relative to vaultRoot, normalized with /
    pathToNoteId.set(note.path, note.id);
    // Also index by filename stem for basename-only matches
    pathToNoteId.set(path.posix.basename(note.path), note.id);
  }

  const semanticEdges = [];

  for (const graphifyPath of graphifyFiles) {
    let data;
    try {
      const raw = await fs.readFile(graphifyPath, 'utf8');
      data = JSON.parse(raw);
    } catch {
      continue; // skip malformed files
    }

    const edges = data.edges ?? [];
    const nodes = data.nodes ?? [];

    // Build graphify nodeId → source_file map
    const nodeSourceFile = new Map();
    for (const node of nodes) {
      if (node.id && node.source_file) {
        nodeSourceFile.set(node.id, node.source_file);
      }
    }

    for (const edge of edges) {
      if (!edge.source || !edge.target) continue;

      const srcFile = nodeSourceFile.get(edge.source);
      const tgtFile = nodeSourceFile.get(edge.target);
      if (!srcFile || !tgtFile) continue;

      const srcId = resolveToNoteId(srcFile, vaultRoot, pathToNoteId);
      const tgtId = resolveToNoteId(tgtFile, vaultRoot, pathToNoteId);
      if (!srcId || !tgtId || srcId === tgtId) continue;

      const edgeKey = `${srcId}=>${tgtId}`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);

      // Weight: EXTRACTED = 0.8, INFERRED = 0.5, AMBIGUOUS = 0.3
      const confidence = edge.confidence ?? 'INFERRED';
      const weight = confidence === 'EXTRACTED' ? 0.8 : confidence === 'INFERRED' ? 0.5 : 0.3;

      semanticEdges.push({
        source: srcId,
        target: tgtId,
        weight,
        kind: 'semantic',
        confidence,
        relation: edge.relation ?? 'related_to',
      });
    }
  }

  return semanticEdges;
}

/**
 * Recursively find all graphify-out/graph.json files under the vault root.
 */
async function findGraphifyOutputs(dir) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and the viewer app itself
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      results.push(...(await findGraphifyOutputs(fullPath)));
    } else if (entry.isFile() && entry.name === 'graph.json') {
      // Check if parent folder is graphify-out
      if (path.basename(path.dirname(fullPath)) === 'graphify-out') {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * Map a graphify source_file path → a CerebroFinnie note ID.
 * Tries: absolute match → relative-to-vault match → basename match.
 */
function resolveToNoteId(sourceFile, vaultRoot, pathToNoteId) {
  if (!sourceFile) return null;

  // Normalize separators
  const normalized = sourceFile.replace(/\\/g, '/');

  // Try direct path match (relative, no extension)
  const withoutExt = normalized.replace(/\.md$/i, '');
  if (pathToNoteId.has(withoutExt)) return pathToNoteId.get(withoutExt);

  // Try stripping vaultRoot prefix
  const vaultNormalized = vaultRoot.replace(/\\/g, '/').replace(/\/?$/, '/');
  if (normalized.startsWith(vaultNormalized)) {
    const relative = normalized.slice(vaultNormalized.length).replace(/\.md$/i, '');
    if (pathToNoteId.has(relative)) return pathToNoteId.get(relative);
  }

  // Try basename match
  const basename = path.posix.basename(normalized, '.md');
  if (pathToNoteId.has(basename)) return pathToNoteId.get(basename);

  return null;
}
