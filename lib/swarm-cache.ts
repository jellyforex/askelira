import type { SwarmResult } from './openclaw-orchestrator';

interface CacheEntry {
  result: SwarmResult;
  expiresAt: number;
}

const DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 100;

const cache = new Map<string, CacheEntry>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now > entry.expiresAt) {
        cache.delete(key);
      }
    }
  }, 60_000);
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    (cleanupTimer as NodeJS.Timeout).unref();
  }
}

export function cacheGet(id: string): SwarmResult | null {
  const entry = cache.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(id);
    return null;
  }
  return entry.result;
}

export function cacheSet(result: SwarmResult, ttl: number = DEFAULT_TTL): void {
  ensureCleanup();
  // Evict oldest if at capacity
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }

  cache.set(result.id, {
    result,
    expiresAt: Date.now() + ttl,
  });
}
