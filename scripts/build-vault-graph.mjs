import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

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

const DEFAULT_COLORS = [
  '#4c7f76',
  '#ce7f38',
  '#cd5c4e',
  '#4b69b1',
  '#8b6eb8',
  '#6d8f4e',
  '#cf9e36',
  '#6a7f98',
  '#9c5e80',
  '#3d8f92',
];

// Map deeper sub-paths to friendly "cluster" labels so multi-level content (like
// pm-brain-main) gets meaningful groupings instead of one giant bucket. Sorted
// by depth descending so the deepest match wins.
const FOLDER_ALIASES = new Map([
  ['pm-brain-main/02-Methods-and-Tools/2.0-Foundations', 'PM • Foundations'],
  ['pm-brain-main/02-Methods-and-Tools/2.1-Strategy', 'PM • Strategy'],
  ['pm-brain-main/02-Methods-and-Tools/2.2-Discovery', 'PM • Discovery'],
  ['pm-brain-main/02-Methods-and-Tools/2.3-Execution', 'PM • Execution'],
  ['pm-brain-main/02-Methods-and-Tools/2.4-Communication', 'PM • Communication'],
  ['pm-brain-main/02-Methods-and-Tools/0-Template-Structure', 'PM • Templates'],
  ['pm-brain-main/02-Methods-and-Tools', 'PM • Methods'],
  ['pm-brain-main/00-Meta', 'PM • Meta'],
  ['pm-brain-main/01-Company-Context', 'PM • Company'],
  ['pm-brain-main/03-Research-Artifacts', 'PM • Research'],
  ['pm-brain-main/04-Initiatives', 'PM • Initiatives'],
  ['pm-brain-main/docs', 'PM • Docs'],
  ['pm-brain-main', 'PM • Core'],
]);

// Dedicated palette so PM clusters get visually distinct, cohesive color bands
// instead of cycling through DEFAULT_COLORS by insertion order.
const PM_PALETTE = new Map([
  ['PM • Meta', '#b39ddb'],
  ['PM • Company', '#ffb74d'],
  ['PM • Foundations', '#4db6ac'],
  ['PM • Strategy', '#7986cb'],
  ['PM • Discovery', '#81c784'],
  ['PM • Execution', '#e57373'],
  ['PM • Communication', '#f06292'],
  ['PM • Templates', '#9fa8da'],
  ['PM • Methods', '#64b5f6'],
  ['PM • Research', '#a1887f'],
  ['PM • Initiatives', '#ffd54f'],
  ['PM • Docs', '#90a4ae'],
  ['PM • Core', '#ba68c8'],
]);

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

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = matter(raw);
    const relativeFile = path.relative(vaultRoot, file);
    const notePath = normalizePath(relativeFile.replace(/\.md$/i, ''));
    const title = extractTitle(parsed.content, path.basename(notePath));
    const aliases = toStringList(parsed.data.aliases);
    const frontmatterTags = toStringList(parsed.data.tags);
    const inlineTags = extractInlineTags(parsed.content);
    const tags = Array.from(new Set([...frontmatterTags, ...inlineTags])).sort();

    notes.push({
      id: notePath,
      title,
      path: notePath,
      folder: deriveFolder(notePath),
      aliases,
      tags,
      rawLinks: extractLinks(parsed.content),
      excerpt: extractExcerpt(parsed.content),
      markdown: parsed.content.trim(),
      fullMarkdown: raw.trim(),
      wordCount: countWords(parsed.content),
      updated: parsed.data.updated ?? null,
      sourceFile: normalizePath(relativeFile),
    });
  }

  const notesById = new Map(notes.map((note) => [note.id, note]));
  const aliasMap = buildLookupMap(notes, (note) => note.aliases);
  const basenameMap = buildLookupMap(notes, (note) => [path.basename(note.path)]);
  const resolvedEdges = [];
  const seenEdges = new Set();

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
        resolvedEdges.push({ source: note.id, target: resolved, weight: 1 });
      }
    }

    note.outgoing = Array.from(new Set(outgoing)).sort();
  }

  const incomingCounts = new Map(notes.map((note) => [note.id, 0]));
  for (const edge of resolvedEdges) {
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  }

  // Synthesize sibling edges for orphan-heavy clusters (e.g. pm-brain-main)
  // so the force layout actually clusters them visually instead of dropping
  // 250+ disconnected nodes into one undifferentiated cloud.
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

    // Only synthesize edges when the folder is mostly orphaned — otherwise the
    // existing wikilink graph is already doing its job.
    const orphanCount = bucket.filter(
      (note) => note.rawLinks.length === 0 && (incomingCounts.get(note.id) ?? 0) === 0,
    ).length;
    if (orphanCount / bucket.length < 0.6) continue;

    const sorted = [...bucket].sort((left, right) => left.path.localeCompare(right.path));
    for (let index = 0; index < sorted.length; index += 1) {
      const source = sorted[index];
      // Link to the next 2 siblings — produces a loose ring per folder.
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

  const groupDefinitions = buildGroupDefinitions(graphSettings);
  const folderColorMap = new Map();
  const distinctFolders = Array.from(new Set(notes.map((note) => note.folder)));
  // Sort so PM groups get assigned first (and keep their dedicated palette),
  // then other folders get cycled through DEFAULT_COLORS in stable order.
  const nonPmFolders = distinctFolders.filter((folder) => !PM_PALETTE.has(folder)).sort();

  for (const folder of distinctFolders) {
    if (PM_PALETTE.has(folder)) {
      folderColorMap.set(folder, PM_PALETTE.get(folder));
    }
  }

  for (const [index, folder] of nonPmFolders.entries()) {
    folderColorMap.set(folder, DEFAULT_COLORS[index % DEFAULT_COLORS.length]);
  }

  for (const note of notes) {
    note.incomingCount = incomingCounts.get(note.id) ?? 0;
    note.outgoingCount = note.outgoing.length;
    note.degree = note.incomingCount + note.outgoingCount;

    const matchingGroup = findBestGroup(note.tags, groupDefinitions);
    note.group = matchingGroup?.key ?? note.folder;
    note.color = matchingGroup?.color ?? folderColorMap.get(note.folder) ?? DEFAULT_COLORS[0];
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
}

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

function deriveFolder(notePath) {
  if (!notePath.includes('/')) {
    return 'Vault Root';
  }

  const segments = notePath.split('/');
  // Try the deepest folder prefix first so e.g. `pm-brain-main/02-Methods-and-Tools/2.1-Strategy/...`
  // matches `PM • Strategy` before falling back to `PM • Methods` or `PM • Core`.
  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const prefix = segments.slice(0, depth).join('/');
    const alias = FOLDER_ALIASES.get(prefix);
    if (alias) {
      return alias;
    }
  }

  return segments[0];
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
