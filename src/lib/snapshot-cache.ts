import type { VaultGraph } from '../types';
import { snapshotCacheKey } from './supabase';

export function readCachedSnapshot() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(snapshotCacheKey);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as VaultGraph;
  } catch {
    window.localStorage.removeItem(snapshotCacheKey);
    return null;
  }
}

export function writeCachedSnapshot(graph: VaultGraph) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(snapshotCacheKey, JSON.stringify(graph));
}

export function clearCachedSnapshot() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(snapshotCacheKey);
}
