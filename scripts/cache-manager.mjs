/**
 * cache-manager.mjs
 *
 * SHA256-based incremental parse cache for build-vault-graph.mjs.
 *
 * Each markdown file is hashed (content only). If a matching cache entry
 * exists under .cerebro-cache/<sha256>.json, the cached parsed result is
 * returned directly — skipping the gray-matter + link-extraction work.
 *
 * Cache files are cheap (a few KB each) and safe to delete at any time;
 * the next build will regenerate them. Add .cerebro-cache/ to .gitignore.
 *
 * Usage:
 *   import { getCached, saveCache } from './cache-manager.mjs';
 *
 *   const cached = await getCached(raw);      // null → not cached
 *   if (cached) { ...use cached... }
 *   else        { ...parse...; await saveCache(raw, parsedResult); }
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(APP_ROOT, '.cerebro-cache');

let cacheReady = false;

/** Lazily create the cache directory. */
async function ensureCacheDir() {
  if (cacheReady) return;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  cacheReady = true;
}

/** SHA256 hex digest of a UTF-8 string. Exported so callers can hash once and reuse. */
export function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Cache file path for a given content hash. */
function cachePath(hash) {
  return path.join(CACHE_DIR, `${hash}.json`);
}

/**
 * Return a previously-cached parse result for `raw`, or null if the file has
 * changed (or was never cached).
 *
 * @param {string} raw - Raw file content
 * @returns {Promise<object | null>}
 */
export async function getCached(raw) {
  return getCachedByHash(sha256(raw));
}

/**
 * Like getCached, but accepts a pre-computed hash to avoid double-hashing.
 * Use this when you've already called sha256(raw) for tracking purposes.
 *
 * @param {string} hash - SHA256 hex digest
 * @returns {Promise<object | null>}
 */
export async function getCachedByHash(hash) {
  await ensureCacheDir();
  try {
    const json = await fs.readFile(cachePath(hash), 'utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Write a parse result to the cache keyed by `raw`'s SHA256.
 *
 * @param {string} raw - Raw file content (used to derive the cache key)
 * @param {object} result - Parsed result to persist
 */
export async function saveCache(raw, result) {
  await saveCacheByHash(sha256(raw), result);
}

/**
 * Like saveCache, but accepts a pre-computed hash.
 *
 * @param {string} hash - SHA256 hex digest
 * @param {object} result - Parsed result to persist
 */
export async function saveCacheByHash(hash, result) {
  await ensureCacheDir();
  await fs.writeFile(cachePath(hash), JSON.stringify(result), 'utf8');
}

/**
 * Evict all cache entries not in the provided set of current hashes.
 * Call this at the end of a build pass to prune stale entries.
 *
 * @param {Set<string>} activeHashes - Hashes seen during this build run
 */
export async function evictStaleCache(activeHashes) {
  await ensureCacheDir();
  let entries;
  try {
    entries = await fs.readdir(CACHE_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const hash = entry.slice(0, -5); // strip .json
    if (!activeHashes.has(hash)) {
      await fs.unlink(path.join(CACHE_DIR, entry)).catch(() => {});
    }
  }
}
