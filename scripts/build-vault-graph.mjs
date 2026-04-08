import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { importGraphifyEdges } from './import-graphify-edges.mjs';
import { sha256, getCachedByHash, saveCacheByHash, evictStaleCache } from './cache-manager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(APP_ROOT, 'public', 'data', 'vault-graph.json');
const CONFIG_PATH = path.join(APP_ROOT, 'cerebro.config.json');
const DEFAULT_EXCLUDED_DIRECTORIES = [
  '.git',
  '.obsidian',
  '.claude',
  '.codex',
  '.next',
  '.turbo',
  '.vercel',
  'node_modules',
  'coverage',
  'build',
  'dist',
  'out',
  'viewer',
  path.basename(APP_ROOT),
];

// Expanded palette — more distinct colors for topology-detected communities.
// Louvain may produce 20–50 communities across a large vault; cycle through these.
const DEFAULT_COLORS = [
  '#4c7f76', '#ce7f38', '#cd5c4e', '#4b69b1', '#8b6eb8',
  '#6d8f4e', '#cf9e36', '#6a7f98', '#9c5e80', '#3d8f92',
  '#e57373', '#81c784', '#64b5f6', '#ffb74d', '#f06292',
  '#4db6ac', '#7986cb', '#a1887f', '#ffd54f', '#90a4ae',
  '#b39ddb', '#80cbc4', '#ef9a9a', '#a5d6a7', '#90caf9',
];

const WIKILINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const INLINE_TAG_PATTERN = /(^|\s)#([A-Za-z0-9_/-]+)/g;

async function main() {
  const config = await readConfig();
  const vaultRoot = await resolveVaultRoot(config);
  const excludedDirectories = buildExcludedDirectories(config);
  const excludedFiles = buildExcludedFiles(config);
  const obsidianGraphPath = path.join(vaultRoot, '.obsidian', 'graph.json');
  const files = await collectMarkdownFiles(vaultRoot, vaultRoot, excludedDirectories, excludedFiles);
  const graphSettings = await readGraphSettings(obsidianGraphPath);
  const notes = [];
  const activeHashes = new Set();
  let cacheHits = 0;

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const relativeFile = path.relative(vaultRoot, file);
    const notePath = normalizePath(relativeFile.replace(/\.md$/i, ''));

    // Compute hash once; track it so eviction knows this file is still live.
    const hash = sha256(raw);
    activeHashes.add(hash);

    // Try cache first — only re-parse if the file content changed.
    const cached = await getCachedByHash(hash);
    if (cached) {
      // Patch the path fields in case the file was renamed (content unchanged).
      cached.id = notePath;
      cached.path = notePath;
      cached.folder = notePath.includes('/') ? notePath.split('/')[0] : 'Vault Root';
      cached.sourceFile = normalizePath(relativeFile);
      notes.push(cached);
      cacheHits += 1;
      continue;
    }

    const parsed = matter(raw);
    const title = extractTitle(parsed.content, path.basename(notePath));
    const aliases = toStringList(parsed.data.aliases);
    const frontmatterTags = toStringList(parsed.data.tags);
    const inlineTags = extractInlineTags(parsed.content);
    const tags = Array.from(new Set([...frontmatterTags, ...inlineTags])).sort();

    const note = {
      id: notePath,
      title,
      path: notePath,
      folder: notePath.includes('/') ? notePath.split('/')[0] : 'Vault Root',
      aliases,
      tags,
      rawLinks: extractLinks(parsed.content),
      excerpt: extractExcerpt(parsed.content),
      markdown: parsed.content.trim(),
      fullMarkdown: raw.trim(),
      wordCount: countWords(parsed.content),
      updated: parsed.data.updated ?? null,
      sourceFile: normalizePath(relativeFile),
    };

    await saveCacheByHash(hash, note);
    notes.push(note);
  }

  // Prune cache entries for files that are no longer in the vault.
  await evictStaleCache(activeHashes);

  if (cacheHits > 0) {
    console.log(`  Cache: ${cacheHits}/${files.length} files served from cache (unchanged)`);
  }

  const notesById = new Map(notes.map((note) => [note.id, note]));
  const aliasMap = buildLookupMap(notes, (note) => note.aliases);
  const basenameMap = buildLookupMap(notes, (note) => [path.basename(note.path)]);
  const resolvedEdges = [];
  const seenEdges = new Set();

  // ── Wikilink edges ─────────────────────────────────────────────────────────
  for (const note of notes) {
    const outgoing = [];

    for (const rawTarget of note.rawLinks) {
      const resolved = resolveNoteTarget(rawTarget, note.path, notesById, basenameMap, aliasMap);
      if (!resolved || resolved === note.id) {
        continue;
      }

      outgoing.push(resolved);

      const edgeKey = `${note.id}=>${resolved}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        resolvedEdges.push({ source: note.id, target: resolved, weight: 1, kind: 'wikilink' });
      }
    }

    note.outgoing = Array.from(new Set(outgoing)).sort();
  }

  // ── Incoming counts (wikilinks only at this stage) ────────────────────────
  const incomingCounts = new Map(notes.map((note) => [note.id, 0]));
  for (const edge of resolvedEdges) {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  }

  // ── Semantic edges from graphify (optional) ───────────────────────────────
  // If the vault contains a graphify-out/graph.json, merge those edges in.
  // They carry real LLM-extracted relationships between notes, tagged as
  // kind: 'semantic' with a confidence field (EXTRACTED / INFERRED / AMBIGUOUS).
  const semanticEdges = await importGraphifyEdges(vaultRoot, notes, seenEdges);
  for (const edge of semanticEdges) {
    resolvedEdges.push(edge);
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
    const sourceNote = notesById.get(edge.source);
    if (sourceNote) {
      sourceNote.outgoing = [...new Set([...(sourceNote.outgoing ?? []), edge.target])].sort();
    }
  }
  if (semanticEdges.length > 0) {
    console.log(`  Merged ${semanticEdges.length} semantic edges from graphify`);
  }

  // ── Sibling edges for orphan-heavy folders ────────────────────────────────
  // For folders where ≥60% of notes have no links at all, synthesize lightweight
  // sibling edges so the force layout doesn't scatter them randomly. Louvain
  // uses these edges to detect the community structure.
  const folderBuckets = new Map();
  for (const note of notes) {
    const parent = path.posix.dirname(note.path);
    if (!folderBuckets.has(parent)) {
      folderBuckets.set(parent, []);
    }
    folderBuckets.get(parent).push(note);
  }

  for (const [, bucket] of folderBuckets) {
    if (bucket.length < 3) continue;

    const orphanCount = bucket.filter(
      (note) => note.rawLinks.length === 0 && (incomingCounts.get(note.id) ?? 0) === 0,
    ).length;
    if (orphanCount / bucket.length < 0.6) continue;

    const sorted = [...bucket].sort((left, right) => left.path.localeCompare(right.path));
    for (let index = 0; index < sorted.length; index += 1) {
      const source = sorted[index];
      for (let offset = 1; offset <= 2; offset += 1) {
        const target = sorted[(index + offset) % sorted.length];
        if (target.id === source.id) continue;
        const edgeKey = `${source.id}=>${target.id}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        resolvedEdges.push({ source: source.id, target: target.id, weight: 0.35, kind: 'sibling' });
        source.outgoing.push(target.id);
        incomingCounts.set(target.id, (incomingCounts.get(target.id) ?? 0) + 1);
      }
    }
  }

  for (const note of notes) {
    note.outgoing = Array.from(new Set(note.outgoing)).sort();
  }

  // ── Topology-based community detection (Louvain) ──────────────────────────
  // Build a graphology undirected graph and run Louvain to detect communities
  // purely from edge structure. This replaces the old folder-name / PM palette
  // approach — communities emerge from what notes *connect to*, not where they sit.
  // Annotate each note with its meaningful "cluster label" (deepest folder segment
  // that makes sense to show in the UI) before passing to detectCommunities.
  for (const note of notes) {
    note._clusterLabel = deriveClusterLabel(note.path);
  }
  const communityMap = detectCommunities(notes, resolvedEdges);
  const topologyCommunityCount = new Set(communityMap.values()).size;

  // Stable color assignment: sort community labels by size descending so the largest
  // communities (most notes) get the most prominent colors in the palette.
  const communitySizes = new Map();
  for (const label of communityMap.values()) {
    communitySizes.set(label, (communitySizes.get(label) ?? 0) + 1);
  }
  const sortedCommunities = Array.from(communitySizes.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
  const communityColors = new Map(
    sortedCommunities.map((label, index) => [label, DEFAULT_COLORS[index % DEFAULT_COLORS.length]]),
  );

  // ── Obsidian color-group definitions (used alongside Louvain) ─────────────
  // If the user has tagged notes with Obsidian color groups, those tags take
  // precedence over Louvain for individual notes (intentional manual override).
  const groupDefinitions = buildGroupDefinitions(graphSettings);

  for (const note of notes) {
    note.incomingCount = incomingCounts.get(note.id) ?? 0;
    note.outgoingCount = note.outgoing.length;
    note.degree = note.incomingCount + note.outgoingCount;

    const communityLabel = communityMap.get(note.id) ?? 'Other';
    const communityColor = communityColors.get(communityLabel) ?? DEFAULT_COLORS[0];

    // Obsidian tag-based group overrides topology group when explicitly set
    const matchingGroup = findBestGroup(note.tags, groupDefinitions);
    note.group = matchingGroup?.key ?? communityLabel;
    note.color = matchingGroup?.color ?? communityColor;

    note.importance = Number(
      (
        note.incomingCount * 1.7 +
        note.outgoingCount * 1.15 +
        note.tags.length * 0.45 +
        Math.min(note.wordCount / 280, 2.5)
      ).toFixed(2)
    );

    delete note.rawLinks;
    delete note.sourceFile;
  }

  notes.sort((left, right) => right.importance - left.importance || left.path.localeCompare(right.path));

  const groups = summarizeGroups(notes);
  const payload = {
    generatedAt: new Date().toISOString(),
    vaultRoot,
    noteCount: notes.length,
    edgeCount: resolvedEdges.length,
    groups,
    notes,
    edges: resolvedEdges,
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Generated ${notes.length} notes and ${resolvedEdges.length} links -> ${OUTPUT_PATH}`);
  console.log(`  Topology communities: ${topologyCommunityCount}; visible groups: ${groups.length}`);
}

// ── Louvain community detection ──────────────────────────────────────────────

/**
 * Run Louvain community detection and return a Map<noteId, communityLabel>.
 *
 * Strategy:
 *  1. Run Louvain at resolution 0.5 to get an initial partition (often 80-150 communities).
 *  2. Iteratively merge the smallest community into its most-connected neighbor until we
 *     reach TARGET_MAX_COMMUNITIES. Isolated nodes merge into the globally largest community.
 *  3. Label each surviving community by its dominant _clusterLabel (deepest folder path).
 *     Communities that share a dominant label get a disambiguation suffix only when needed.
 */
function detectCommunities(notes, edges) {
  const TARGET_MAX_COMMUNITIES = 22; // aim for UI-friendly number of color bands
  const LOUVAIN_RESOLUTION = 0.5;   // lower = coarser initial partition

  const G = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });

  for (const note of notes) {
    G.addNode(note.id, { clusterLabel: note._clusterLabel ?? note.folder });
  }

  for (const edge of edges) {
    if (!G.hasNode(edge.source) || !G.hasNode(edge.target)) continue;
    if (edge.source === edge.target) continue;
    if (G.hasEdge(edge.source, edge.target)) continue;
    G.addEdge(edge.source, edge.target, { weight: edge.weight ?? 1 });
  }

  if (G.size === 0) {
    return new Map(notes.map((n) => [n.id, 'Vault Root']));
  }

  const rawCommunities = louvain(G, {
    getEdgeWeight: 'weight',
    randomWalk: true,
    resolution: LOUVAIN_RESOLUTION,
  });

  // assignment: Map<nodeId, communityId>  (mutable, numeric IDs throughout)
  const assignment = new Map(Object.entries(rawCommunities));

  // Helper: rebuild a Map<communityId, nodeId[]> from current assignment
  function buildMemberMap() {
    const m = new Map();
    for (const [nodeId, cid] of assignment) {
      if (!m.has(cid)) m.set(cid, []);
      m.get(cid).push(nodeId);
    }
    return m;
  }

  // Iteratively merge the smallest community into its best neighbor
  // until we are at or below TARGET_MAX_COMMUNITIES.
  let memberMap = buildMemberMap();
  while (memberMap.size > TARGET_MAX_COMMUNITIES) {
    // Sort communities ascending by member count
    const sorted = Array.from(memberMap.entries()).sort((a, b) => a[1].length - b[1].length);
    const [smallestCid, smallestMembers] = sorted[0];

    // Count cross-edges from smallest community to each neighbor community
    const neighborCounts = new Map();
    for (const nodeId of smallestMembers) {
      if (!G.hasNode(nodeId)) continue;
      for (const neighbor of G.neighbors(nodeId)) {
        const neighborCid = assignment.get(neighbor);
        if (neighborCid !== undefined && neighborCid !== smallestCid) {
          neighborCounts.set(neighborCid, (neighborCounts.get(neighborCid) ?? 0) + 1);
        }
      }
    }

    // Pick target: most cross-edges wins; if isolated, pick the globally largest community
    let targetCid;
    if (neighborCounts.size > 0) {
      targetCid = Array.from(neighborCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    } else {
      targetCid = sorted[sorted.length - 1][0]; // largest community
    }

    // Reassign all members of smallest community to target
    for (const nodeId of smallestMembers) {
      assignment.set(nodeId, targetCid);
    }

    // Rebuild only the two affected entries rather than scanning everything
    const targetMembers = memberMap.get(targetCid) ?? [];
    memberMap.delete(smallestCid);
    memberMap.set(targetCid, [...targetMembers, ...smallestMembers]);
  }

  // ── Label surviving communities ──────────────────────────────────────────────
  // Each community is labeled by the title of its highest-degree node (most
  // connections in the graph). This gives meaningful, readable labels even for
  // orphan-heavy folders where folder paths would all look the same.
  // Ties are broken by note title alphabetically.
  const notesById = new Map(notes.map((n) => [n.id, n]));

  // Sort communities by size desc so largest community gets label priority
  const sortedCids = Array.from(memberMap.keys()).sort((a, b) => {
    return (memberMap.get(b)?.length ?? 0) - (memberMap.get(a)?.length ?? 0);
  });

  const usedLabels = new Set();
  const cidToLabel = new Map();

  for (const cid of sortedCids) {
    const members = memberMap.get(cid);
    if (!members) continue;

    // Find the highest-degree note in this community
    let bestNote = null;
    let bestDegree = -1;
    for (const nodeId of members) {
      const note = notesById.get(nodeId);
      if (!note) continue;
      const deg = G.degree(nodeId);
      if (deg > bestDegree || (deg === bestDegree && (note.title ?? '').localeCompare(bestNote?.title ?? '') < 0)) {
        bestDegree = deg;
        bestNote = note;
      }
    }

    // Build label: note title, falling back to folder path if note has no title
    const rawTitle = bestNote?.title ?? bestNote?._clusterLabel ?? 'Cluster';
    // Truncate long titles to keep the UI chip readable
    const truncated = rawTitle.length > 40 ? `${rawTitle.slice(0, 38)}…` : rawTitle;

    // Disambiguate if another community already claimed this label
    let label = truncated;
    if (usedLabels.has(label)) {
      let idx = 2;
      while (usedLabels.has(`${truncated} (${idx})`)) idx += 1;
      label = `${truncated} (${idx})`;
    }

    usedLabels.add(label);
    cidToLabel.set(cid, label);
  }

  // Build final Map<noteId, label>
  const result = new Map();
  for (const [nodeId, cid] of assignment) {
    result.set(nodeId, cidToLabel.get(cid) ?? 'Other');
  }

  return result;
}

// ── File collection ──────────────────────────────────────────────────────────

async function collectMarkdownFiles(rootDirectory, vaultRoot, excludedDirectories = new Set(), excludedFiles = new Set()) {
  const entries = await fs.readdir(rootDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDirectory, entry.name);
    const relativePath = normalizePath(path.relative(vaultRoot, absolutePath));

    if (entry.isDirectory()) {
      if (shouldExcludeDirectory(entry.name, relativePath, excludedDirectories)) {
        continue;
      }

      files.push(...(await collectMarkdownFiles(absolutePath, vaultRoot, excludedDirectories, excludedFiles)));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith('.md') &&
      !shouldExcludeFile(entry.name, relativePath, excludedFiles)
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function readGraphSettings(obsidianGraphPath) {
  try {
    const raw = await fs.readFile(obsidianGraphPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function resolveVaultRoot(config) {
  const configuredPath = process.env.CEREBRO_VAULT_PATH ?? config.vaultPath;
  if (configuredPath) {
    const resolved = path.resolve(APP_ROOT, configuredPath);
    await assertVaultRoot(resolved);
    return resolved;
  }

  const discovered = await findVaultUpTree(APP_ROOT);
  if (discovered) {
    return discovered;
  }

  throw new Error(
    [
      'Unable to resolve the Obsidian vault path.',
      'Set CEREBRO_VAULT_PATH or create cerebro.config.json with {"vaultPath": "C:/path/to/vault"}.',
    ].join(' '),
  );
}

async function assertVaultRoot(candidatePath) {
  const obsidianPath = path.join(candidatePath, '.obsidian');

  try {
    const stat = await fs.stat(obsidianPath);
    if (!stat.isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error(`Resolved vault path does not contain an .obsidian directory: ${candidatePath}`);
  }
}

async function findVaultUpTree(startPath) {
  let currentPath = startPath;

  while (true) {
    const obsidianPath = path.join(currentPath, '.obsidian');
    try {
      const stat = await fs.stat(obsidianPath);
      if (stat.isDirectory()) {
        return currentPath;
      }
    } catch {
      // Keep walking upward.
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

function buildExcludedDirectories(config) {
  const configured = Array.isArray(config.excludeDirectories)
    ? config.excludeDirectories.map((value) => String(value))
    : [];

  return new Set([...DEFAULT_EXCLUDED_DIRECTORIES, ...configured]);
}

function buildExcludedFiles(config) {
  const configured = Array.isArray(config.excludeFiles) ? config.excludeFiles.map((value) => normalizePath(String(value))) : [];
  return new Set(configured.filter(Boolean));
}

function shouldExcludeDirectory(entryName, relativePath, excludedDirectories) {
  if (excludedDirectories.has(entryName) || excludedDirectories.has(relativePath)) {
    return true;
  }

  return entryName.startsWith('.') && entryName !== '.obsidian';
}

function shouldExcludeFile(entryName, relativePath, excludedFiles) {
  if (excludedFiles.has(entryName) || excludedFiles.has(relativePath)) {
    return true;
  }

  return false;
}

function buildGroupDefinitions(graphSettings) {
  const colorGroups = Array.isArray(graphSettings?.colorGroups) ? graphSettings.colorGroups : [];

  return colorGroups
    .map((group) => {
      const match = typeof group?.query === 'string' ? group.query.match(/^tag:#(.+)$/) : null;
      if (!match) {
        return null;
      }

      return {
        key: match[1],
        color: rgbNumberToHex(group?.color?.rgb),
      };
    })
    .filter(Boolean);
}

function buildLookupMap(notes, picker) {
  const values = new Map();

  for (const note of notes) {
    for (const value of picker(note)) {
      const normalized = normalizePath(String(value).replace(/\.md$/i, '').trim());
      if (!normalized) {
        continue;
      }

      const existing = values.get(normalized);
      if (!existing) {
        values.set(normalized, [note.id]);
      } else {
        existing.push(note.id);
      }
    }
  }

  return values;
}

function resolveNoteTarget(rawTarget, sourcePath, notesById, basenameMap, aliasMap) {
  const normalized = normalizePath(rawTarget.replace(/\.md$/i, '').trim());
  if (!normalized) {
    return null;
  }

  if (notesById.has(normalized)) {
    return normalized;
  }

  const sourceDirectory = path.posix.dirname(sourcePath);
  const relativeCandidate = normalizePath(path.posix.normalize(path.posix.join(sourceDirectory, normalized)));
  if (notesById.has(relativeCandidate)) {
    return relativeCandidate;
  }

  const basenameMatches = basenameMap.get(path.posix.basename(normalized));
  if (basenameMatches?.length === 1) {
    return basenameMatches[0];
  }

  const aliasMatches = aliasMap.get(normalized);
  if (aliasMatches?.length === 1) {
    return aliasMatches[0];
  }

  return null;
}

function extractTitle(content, fallback) {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

function extractLinks(content) {
  return Array.from(content.matchAll(WIKILINK_PATTERN), (match) => match[1].trim());
}

function extractInlineTags(content) {
  const tags = new Set();
  for (const match of content.matchAll(INLINE_TAG_PATTERN)) {
    tags.add(match[2].trim());
  }
  return Array.from(tags).sort();
}

function extractExcerpt(content) {
  const cleanedLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('> ') && !line.startsWith('|') && !line.startsWith('- '));

  const excerpt = cleanedLines
    .join(' ')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || path.posix.basename(target))
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[`*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return excerpt.slice(0, 280);
}

function countWords(content) {
  const text = content.replace(/\s+/g, ' ').trim();
  return text ? text.split(' ').length : 0;
}

function toStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.replace(/[[\]]/g, '').trim())
      .filter(Boolean);
  }

  return [];
}

function summarizeGroups(notes) {
  const groups = new Map();

  for (const note of notes) {
    const existing = groups.get(note.group);
    if (existing) {
      existing.count += 1;
      continue;
    }

    groups.set(note.group, {
      key: note.group,
      label: note.group,
      color: note.color,
      count: 1,
    });
  }

  return Array.from(groups.values()).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function findBestGroup(tags, groups) {
  return groups
    .filter((group) => tags.some((tag) => tag === group.key || tag.startsWith(`${group.key}/`)))
    .sort((left, right) => right.key.length - left.key.length)[0];
}

/**
 * Returns a fallback cluster label for a note path (used only when a note
 * has degree 0 and no title can be derived from the graph).
 * Uses the immediate parent directory name.
 */
function deriveClusterLabel(notePath) {
  const segments = notePath.split('/');
  if (segments.length === 1) return 'Vault Root';
  return segments[segments.length - 2];
}

function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
}

function rgbNumberToHex(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_COLORS[0];
  }

  return `#${value.toString(16).padStart(6, '0')}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
