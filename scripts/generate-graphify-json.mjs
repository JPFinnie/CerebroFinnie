import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(APP_ROOT, 'cerebro.config.json');
const SNAPSHOT_PATH = path.join(APP_ROOT, 'public', 'data', 'vault-graph.json');
const DEFAULT_TARGET_PREFIX = 'pm-brain-main';
const OUTPUT_DIRECTORY_NAME = 'graphify-out';
const OUTPUT_FILE_NAME = 'graph.json';
const MAX_SIMILAR_NEIGHBORS = 4;
const MIN_SIMILARITY = 0.22;
const STRONG_SIMILARITY = 0.34;
const REFERENCE_BOOST = 0.08;
const MAX_BODY_TOKENS = 1800;
const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because',
  'been', 'being', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'done',
  'each', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'how', 'if', 'in', 'into', 'is',
  'it', 'its', 'just', 'may', 'might', 'more', 'most', 'need', 'not', 'of', 'on', 'or', 'our',
  'out', 'over', 'same', 'should', 'so', 'some', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'up', 'use', 'used', 'using',
  'very', 'was', 'we', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why',
  'will', 'with', 'you', 'your',
]);
async function main() {
  const config = await readConfig();
  const vaultRoot = await resolveVaultRoot(config);
  const targetPrefix = normalizePath(process.argv[2] || DEFAULT_TARGET_PREFIX);
  const targetRoot = path.join(vaultRoot, targetPrefix);
  const outputDirectory = path.join(targetRoot, OUTPUT_DIRECTORY_NAME);
  const outputFile = path.join(outputDirectory, OUTPUT_FILE_NAME);
  const snapshot = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf8'));
  const targetNotes = (snapshot.notes ?? [])
    .filter((note) => isWithinTarget(note.path, targetPrefix))
    .map((note) => enrichNote(note));

  if (targetNotes.length === 0) {
    throw new Error(`No notes found in snapshot for target prefix: ${targetPrefix}`);
  }

  const pairEdges = new Map();
  buildSimilarityEdges(targetNotes, pairEdges);

  const edges = Array.from(pairEdges.values())
    .sort((left, right) => {
      return (
        right.score - left.score ||
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target)
      );
    })
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      confidence: edge.confidence,
      source_file: edge.sourceFile,
      score: Number(edge.score.toFixed(3)),
    }));

  const nodes = targetNotes.map((note) => ({
    id: note.id,
    label: note.title,
    file_type: 'document',
    source_file: `${note.path}.md`,
  }));

  const payload = {
    generated_at: new Date().toISOString(),
    method: 'cerebro-tfidf-bootstrap-v1',
    target_root: targetPrefix,
    nodes,
    edges,
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(payload, null, 2), 'utf8');

  const countsByConfidence = edges.reduce((counts, edge) => {
    counts[edge.confidence] = (counts[edge.confidence] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`Generated ${edges.length} semantic edges for ${targetNotes.length} notes -> ${outputFile}`);
  console.log(`  Confidence mix: ${JSON.stringify(countsByConfidence)}`);
}

function buildSimilarityEdges(notes, pairEdges) {
  const documentFrequencies = new Map();
  const weightedTermsByNote = new Map();

  for (const note of notes) {
    const weightedTerms = buildWeightedTerms(note);
    weightedTermsByNote.set(note.id, weightedTerms);
    for (const term of weightedTerms.keys()) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
    }
  }

  const vectors = new Map();
  for (const note of notes) {
    const weightedTerms = weightedTermsByNote.get(note.id) ?? new Map();
    const vector = new Map();
    let magnitude = 0;

    for (const [term, frequency] of weightedTerms) {
      const idf = Math.log((notes.length + 1) / ((documentFrequencies.get(term) ?? 0) + 1)) + 1;
      const weight = frequency * idf;
      vector.set(term, weight);
      magnitude += weight * weight;
    }

    vectors.set(note.id, {
      vector,
      magnitude: Math.sqrt(magnitude),
    });
  }

  const pairCandidates = [];
  for (let index = 0; index < notes.length; index += 1) {
    for (let offset = index + 1; offset < notes.length; offset += 1) {
      const left = notes[index];
      const right = notes[offset];
      const pairKey = buildPairKey(left.id, right.id);
      if (pairEdges.has(pairKey)) continue;

      let score = cosineSimilarity(vectors.get(left.id), vectors.get(right.id));
      if (
        (right.referencePhrase && left.normalizedBody.includes(right.referencePhrase)) ||
        (left.referencePhrase && right.normalizedBody.includes(left.referencePhrase))
      ) {
        score += REFERENCE_BOOST;
      }
      if (score < MIN_SIMILARITY) continue;

      pairCandidates.push({ left, right, score, pairKey });
    }
  }

  const candidateCounts = new Map(notes.map((note) => [note.id, 0]));
  pairCandidates.sort((left, right) => {
    return (
      right.score - left.score ||
      left.left.id.localeCompare(right.left.id) ||
      left.right.id.localeCompare(right.right.id)
    );
  });

  for (const candidate of pairCandidates) {
    if ((candidateCounts.get(candidate.left.id) ?? 0) >= MAX_SIMILAR_NEIGHBORS) continue;
    if ((candidateCounts.get(candidate.right.id) ?? 0) >= MAX_SIMILAR_NEIGHBORS) continue;
    if (pairEdges.has(candidate.pairKey)) continue;

    const source = candidate.left.id.localeCompare(candidate.right.id) <= 0 ? candidate.left : candidate.right;
    const target = source.id === candidate.left.id ? candidate.right : candidate.left;
    const confidence = candidate.score >= STRONG_SIMILARITY ? 'INFERRED' : 'AMBIGUOUS';

    pairEdges.set(candidate.pairKey, {
      source: source.id,
      target: target.id,
      relation: 'semantically_similar_to',
      confidence,
      sourceFile: `${source.path}.md`,
      score: candidate.score,
    });

    candidateCounts.set(candidate.left.id, (candidateCounts.get(candidate.left.id) ?? 0) + 1);
    candidateCounts.set(candidate.right.id, (candidateCounts.get(candidate.right.id) ?? 0) + 1);
  }
}

function buildWeightedTerms(note) {
  const weightedTerms = new Map();
  addTerms(weightedTerms, note.titleTokens, 4.5);
  addTerms(weightedTerms, note.pathTokens, 2.4);
  addTerms(weightedTerms, note.tagTokens, 2.1);
  addTerms(weightedTerms, note.headingTokens, 1.8);
  addTerms(weightedTerms, note.bodyTokens, 1);
  return weightedTerms;
}

function addTerms(target, tokens, weight) {
  for (const token of tokens) {
    target.set(token, (target.get(token) ?? 0) + weight);
  }
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.magnitude === 0 || right.magnitude === 0) {
    return 0;
  }

  const [smaller, larger] = left.vector.size <= right.vector.size ? [left.vector, right.vector] : [right.vector, left.vector];
  let dot = 0;
  for (const [term, weight] of smaller) {
    dot += weight * (larger.get(term) ?? 0);
  }

  return dot / (left.magnitude * right.magnitude);
}

function enrichNote(note) {
  const markdown = String(note.fullMarkdown ?? note.markdown ?? note.excerpt ?? '');
  const plainText = markdownToText(markdown);
  const headings = extractHeadings(markdown);
  const title = note.title || path.posix.basename(note.path);

  return {
    id: note.path,
    path: note.path,
    title,
    normalizedBody: normalizePhrase(plainText),
    referencePhrase: buildReferencePhrase(title),
    titleTokens: withBigrams(tokenize(title)),
    pathTokens: withBigrams(tokenize(note.path.replace(/[/.]/g, ' '))),
    tagTokens: withBigrams(
      (Array.isArray(note.tags) ? note.tags : [])
        .filter((tag) => !/^\d+([./-]\d+)*$/.test(String(tag).trim()))
        .flatMap((tag) => tokenize(String(tag).replace(/\//g, ' '))),
    ),
    headingTokens: withBigrams(tokenize(headings.join(' '))),
    bodyTokens: withBigrams(tokenize(plainText).slice(0, MAX_BODY_TOKENS)),
  };
}

function buildReferencePhrase(title) {
  const normalized = normalizePhrase(title);
  if (!normalized || normalized.length < 12) return null;
  if (normalized.split(' ').filter(Boolean).length < 2) return null;
  return normalized;
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .replace(/\[\[|\]\]/g, ' ')
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOPWORDS.has(token));
}

function withBigrams(tokens) {
  const values = [...tokens];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    values.push(`${tokens[index]}_${tokens[index + 1]}`);
  }
  return values;
}

function markdownToText(markdown) {
  return markdown
    .replace(/^---[\s\S]*?---/m, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeadings(markdown) {
  return String(markdown)
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim());
}

function normalizePhrase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPairKey(left, right) {
  return left.localeCompare(right) <= 0 ? `${left}<>${right}` : `${right}<>${left}`;
}

function isWithinTarget(notePath, targetPrefix) {
  return notePath === targetPrefix || notePath.startsWith(`${targetPrefix}/`);
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
  if (!configuredPath) {
    throw new Error('Unable to resolve vault path. Set CEREBRO_VAULT_PATH or cerebro.config.json.');
  }

  return path.resolve(APP_ROOT, configuredPath);
}

function normalizePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.?\//, '').trim();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
