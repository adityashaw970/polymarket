export { CACHE_TTL } from './constants';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private stats = {
    hits: 0,
    misses: 0,
  };

  get<T>(key: string): T | null {
    const entry = this.store.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttl: number): void {
    this.store.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  async getOrCompute<T>(key: string, fn: () => Promise<T>, ttl: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    const data = await fn();
    this.set(key, data, ttl);
    return data;
  }

  clear(key: string): void {
    this.store.delete(key);
  }

  clearAll(): void {
    this.store.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: hitRate.toFixed(1) + '%',
      size: this.store.size,
    };
  }

  cleanup(): number {
    let removed = 0;
    const now = Date.now();

    for (const [key, entry] of this.store.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.store.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

// ============================================================================
// CACHE KEY BUILDERS
// ============================================================================

export class CacheKeys {
  static leaderboard(category: string, timePeriod: string, limit: number, offset: number): string {
    return `leaderboard:${category}:${timePeriod}:${limit}:${offset}`;
  }

  static traderPositions(wallet: string): string {
    return `positions:${wallet}`;
  }

  static traderTrades(wallet: string, limit?: number, offset?: number): string {
    return `trades:${wallet}:${limit ?? 'all'}:${offset ?? 0}`;
  }

  static traderActivity(wallet: string, limit?: number, offset?: number): string {
    return `activity:${wallet}:${limit ?? 'all'}:${offset ?? 0}`;
  }

  static traderScore(wallet: string): string {
    return `score:${wallet}`;
  }

  static market(marketId: string): string {
    return `market:${marketId}`;
  }

  static event(eventSlug: string): string {
    return `event:${eventSlug}`;
  }

  static marketHolders(marketId: string, limit?: number, offset?: number): string {
    return `holders:${marketId}:${limit ?? 'all'}:${offset ?? 0}`;
  }

  static price(tokenId: string): string {
    return `price:${tokenId}`;
  }

  static orderBook(tokenId: string): string {
    return `orderbook:${tokenId}`;
  }

  static profile(address: string): string {
    return `profile:${address}`;
  }

  static orderbookAnalytics(tokenId: string): string {
    return `ob-analytics:${tokenId}`;
  }
}

// ============================================================================
// SINGLETON CACHE INSTANCE (Next.js Hot-Reload Safe)
// ============================================================================

const globalForCache = globalThis as unknown as {
  cache?: Cache;
  cacheInterval?: ReturnType<typeof setInterval>;
};

export const cache = globalForCache.cache ?? new Cache();

if (process.env.NODE_ENV !== 'production') {
  globalForCache.cache = cache;
}

// ============================================================================
// CACHE CLEANUP INTERVAL
// ============================================================================

if (typeof globalThis !== 'undefined' && typeof setInterval !== 'undefined') {
  if (!globalForCache.cacheInterval) {
    globalForCache.cacheInterval = setInterval(() => {
      const removed = cache.cleanup();
      if (removed > 0) {
        console.log(`[Cache] Cleaned up ${removed} expired entries`);
      }
    }, 10 * 60 * 1000);
  }
}
