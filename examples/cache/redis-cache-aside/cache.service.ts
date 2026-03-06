import Redis from "ioredis";

/**
 * Generic cache-aside service built on ioredis.
 *
 * Pattern:
 *   READ:  check cache → hit: return cached → miss: query DB → store in cache → return
 *   WRITE: update DB → invalidate cache (delete key)
 *
 * This ensures the database is always the source of truth.
 * Cache is populated lazily on reads and invalidated on writes.
 */
export class CacheService {
  private redis: Redis;
  private defaultTTL: number;
  private keyPrefix: string;

  constructor(options?: {
    redisUrl?: string;
    defaultTTL?: number;
    keyPrefix?: string;
  }) {
    this.redis = new Redis(options?.redisUrl ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Exponential backoff capped at 2 seconds
        return Math.min(times * 200, 2000);
      },
    });
    this.defaultTTL = options?.defaultTTL ?? 300; // 5 minutes
    this.keyPrefix = options?.keyPrefix ?? "cache";
  }

  private buildKey(namespace: string, id: string | number): string {
    return `${this.keyPrefix}:${namespace}:${id}`;
  }

  /**
   * Get from cache. Returns null on miss.
   */
  async get<T>(namespace: string, id: string | number): Promise<T | null> {
    const key = this.buildKey(namespace, id);
    const cached = await this.redis.get(key);

    if (cached === null) {
      return null;
    }

    return JSON.parse(cached) as T;
  }

  /**
   * Store a value in cache with TTL.
   */
  async set<T>(
    namespace: string,
    id: string | number,
    data: T,
    ttl?: number
  ): Promise<void> {
    const key = this.buildKey(namespace, id);
    const serialized = JSON.stringify(data);
    await this.redis.setex(key, ttl ?? this.defaultTTL, serialized);
  }

  /**
   * Invalidate a single cached entry.
   * Call this after any write/update/delete to the database.
   */
  async invalidate(namespace: string, id: string | number): Promise<void> {
    const key = this.buildKey(namespace, id);
    await this.redis.del(key);
  }

  /**
   * Invalidate all entries in a namespace using SCAN (non-blocking).
   * Useful when a bulk update affects many records.
   */
  async invalidateNamespace(namespace: string): Promise<number> {
    const pattern = `${this.keyPrefix}:${namespace}:*`;
    let cursor = "0";
    let deletedCount = 0;

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== "0");

    return deletedCount;
  }

  /**
   * Cache-aside read-through helper.
   * Checks cache first; on miss, calls the fetcher, caches the result.
   */
  async getOrFetch<T>(
    namespace: string,
    id: string | number,
    fetcher: () => Promise<T | null>,
    ttl?: number
  ): Promise<{ data: T | null; fromCache: boolean }> {
    // 1. Check cache
    const cached = await this.get<T>(namespace, id);
    if (cached !== null) {
      return { data: cached, fromCache: true };
    }

    // 2. Cache miss — fetch from database
    const data = await fetcher();

    // 3. Populate cache (only cache non-null results)
    if (data !== null) {
      await this.set(namespace, id, data, ttl);
    }

    return { data, fromCache: false };
  }

  /**
   * Get cache stats for monitoring.
   */
  async getStats(): Promise<{
    usedMemory: string;
    connectedClients: string;
    keyspaceHits: string;
    keyspaceMisses: string;
    hitRate: string;
  }> {
    const info = await this.redis.info("stats");
    const memory = await this.redis.info("memory");

    const parse = (text: string, key: string) => {
      const match = text.match(new RegExp(`${key}:(\\S+)`));
      return match?.[1] ?? "0";
    };

    const hits = parseInt(parse(info, "keyspace_hits"), 10);
    const misses = parseInt(parse(info, "keyspace_misses"), 10);
    const total = hits + misses;

    return {
      usedMemory: parse(memory, "used_memory_human"),
      connectedClients: parse(info, "connected_clients"),
      keyspaceHits: String(hits),
      keyspaceMisses: String(misses),
      hitRate: total > 0 ? `${((hits / total) * 100).toFixed(1)}%` : "N/A",
    };
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
