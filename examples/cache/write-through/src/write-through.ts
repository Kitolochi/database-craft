/**
 * WRITE-THROUGH CACHE PATTERN
 *
 * On every write, the cache is updated synchronously alongside the
 * database. This guarantees strong consistency — the cache always
 * reflects the latest committed data.
 *
 * Flow:
 *   READ:  cache hit → return | cache miss → DB query → populate cache → return
 *   WRITE: update DB → update cache (both in the same operation)
 *
 * ─── Comparison with Cache-Aside (see ../redis-cache-aside/) ──
 *
 * Cache-Aside (lazy loading):
 *   - WRITE: update DB → invalidate cache (delete key)
 *   - Next read after write is always a cache miss (cold read)
 *   - Simpler — no risk of cache/DB inconsistency on write failures
 *   - Better when reads are infrequent after writes
 *
 * Write-Through:
 *   - WRITE: update DB → update cache (not delete)
 *   - Next read after write is a cache hit (warm read)
 *   - Slightly more complex — must handle write-to-cache failures
 *   - Better when data is read frequently after being written
 *   - Prevents cache stampede on popular keys after writes
 *
 * ─── Cache Stampede Prevention ────────────────────────────
 *
 * A "stampede" happens when a popular cache key expires and
 * hundreds of concurrent requests all miss the cache and hit
 * the database simultaneously. Write-through avoids this for
 * writes (cache is always populated), but stampedes can still
 * happen on TTL expiry. We prevent this with a mutex lock:
 *
 *   1. First request acquires the lock, fetches from DB, populates cache
 *   2. Other requests wait for the lock, then read from cache
 *   3. Lock has a short timeout to prevent deadlocks
 *
 * SQL equivalent (advisory locks):
 *   SELECT pg_try_advisory_lock(hashtext('cache:user:42'));
 *   -- fetch and populate cache
 *   SELECT pg_advisory_unlock(hashtext('cache:user:42'));
 */

// ─── Types ────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin" | "moderator";
  loginCount: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number; // Unix timestamp in ms
}

interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  stampedePrevented: number;
}

// ─── Simulated Database ───────────────────────────────────

const db: Map<number, User> = new Map();
let dbQueryCount = 0;

function dbInsert(user: User): void {
  db.set(user.id, { ...user });
  dbQueryCount++;
}

function dbUpdate(id: number, changes: Partial<User>): User {
  const existing = db.get(id);
  if (!existing) throw new Error(`DB: User ${id} not found`);
  const updated = { ...existing, ...changes };
  db.set(id, updated);
  dbQueryCount++;
  return { ...updated };
}

function dbSelect(id: number): User | null {
  dbQueryCount++;
  const user = db.get(id);
  return user ? { ...user } : null;
}

function dbDelete(id: number): void {
  db.delete(id);
  dbQueryCount++;
}

// ─── In-Memory Cache with TTL ─────────────────────────────

const cache: Map<string, CacheEntry<unknown>> = new Map();
const locks: Map<string, Promise<void>> = new Map();
const DEFAULT_TTL_MS = 60_000; // 60 seconds

const stats: CacheStats = {
  hits: 0,
  misses: 0,
  writes: 0,
  evictions: 0,
  stampedePrevented: 0,
};

function buildKey(namespace: string, id: number): string {
  return `${namespace}:${id}`;
}

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;

  // Check TTL expiry
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    stats.evictions++;
    return null;
  }

  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

function cacheDelete(key: string): void {
  cache.delete(key);
}

// ─── Stampede Lock ────────────────────────────────────────
//
// When multiple requests miss the cache at the same time (e.g.,
// after TTL expiry on a popular key), only one should query the
// database. The rest wait for that one to finish and then read
// from the freshly populated cache.

async function acquireLock(key: string): Promise<boolean> {
  const lockKey = `lock:${key}`;
  if (locks.has(lockKey)) {
    // Another request already holds the lock — wait for it
    stats.stampedePrevented++;
    await locks.get(lockKey);
    return false; // Lock was held by someone else; cache should be populated now
  }

  // Acquire the lock by creating a promise that resolves when we're done
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  locks.set(lockKey, lockPromise);

  // Auto-release after 5 seconds to prevent deadlocks
  const timeout = setTimeout(() => {
    locks.delete(lockKey);
    releaseLock!();
  }, 5000);

  // Return a release function via closure
  const originalRelease = releaseLock!;
  locks.set(lockKey, lockPromise);

  // Override the lock entry with the cleanup-aware promise
  const cleanupLock = () => {
    clearTimeout(timeout);
    locks.delete(lockKey);
    originalRelease();
  };
  (lockPromise as any).__release = cleanupLock;

  return true; // We acquired the lock
}

function releaseLock(key: string): void {
  const lockKey = `lock:${key}`;
  const lockPromise = locks.get(lockKey);
  if (lockPromise && (lockPromise as any).__release) {
    (lockPromise as any).__release();
  }
}

// ─── Write-Through Cache Service ──────────────────────────

const NAMESPACE = "user";

/**
 * READ: cache hit → return | cache miss → lock → DB → populate → return
 *
 * Stampede prevention: if multiple readers miss the cache at the
 * same time, only the first one queries the DB. The rest wait
 * for the first to finish, then read from cache.
 */
async function getUser(id: number): Promise<User | null> {
  const key = buildKey(NAMESPACE, id);

  // 1. Check cache
  const cached = cacheGet<User>(key);
  if (cached) {
    stats.hits++;
    return cached;
  }

  stats.misses++;

  // 2. Cache miss — try to acquire lock (stampede prevention)
  const gotLock = await acquireLock(key);

  if (!gotLock) {
    // Another request populated the cache while we waited
    const afterWait = cacheGet<User>(key);
    if (afterWait) {
      stats.hits++;
      return afterWait;
    }
  }

  try {
    // 3. We have the lock (or no contention) — fetch from DB
    const user = dbSelect(id);

    // 4. Populate cache (even null results could be cached to prevent repeated DB misses)
    if (user) {
      cacheSet(key, user);
    }

    return user;
  } finally {
    if (gotLock) {
      releaseLock(key);
    }
  }
}

/**
 * WRITE: update DB → update cache (atomic from the caller's perspective)
 *
 * Unlike cache-aside which invalidates (deletes) the cache key,
 * write-through updates the cache with the new value. The next
 * read is guaranteed to be a cache hit with fresh data.
 */
async function updateUser(id: number, changes: Partial<Pick<User, "name" | "email" | "role">>): Promise<User> {
  const key = buildKey(NAMESPACE, id);

  // 1. Update database first (source of truth)
  const updated = dbUpdate(id, changes);

  // 2. Update cache with the new value (write-through)
  //    In cache-aside, this would be: cacheDelete(key)
  cacheSet(key, updated);
  stats.writes++;

  return updated;
}

/**
 * CREATE: insert DB → populate cache
 */
async function createUser(user: User): Promise<User> {
  const key = buildKey(NAMESPACE, user.id);

  // 1. Insert into database
  dbInsert(user);

  // 2. Populate cache immediately (write-through)
  cacheSet(key, { ...user });
  stats.writes++;

  return user;
}

/**
 * DELETE: remove from DB → remove from cache
 */
async function deleteUser(id: number): Promise<void> {
  const key = buildKey(NAMESPACE, id);

  // 1. Delete from database
  dbDelete(id);

  // 2. Remove from cache
  cacheDelete(key);
}

/**
 * INCREMENT: read-modify-write with cache update
 *
 * For counters and frequently-updated fields, write-through
 * keeps the cache warm. Cache-aside would invalidate on every
 * increment, causing a miss on the next read.
 */
async function incrementLoginCount(id: number): Promise<User> {
  const key = buildKey(NAMESPACE, id);

  // Read current state (prefer cache)
  const current = await getUser(id);
  if (!current) throw new Error(`User ${id} not found`);

  // Update DB with incremented count
  const updated = dbUpdate(id, { loginCount: current.loginCount + 1 });

  // Write-through: update cache with new value
  cacheSet(key, updated);
  stats.writes++;

  return updated;
}

// ─── Formatting Helpers ───────────────────────────────────

function formatUser(u: User): string {
  return `id=${u.id} name="${u.name}" email=${u.email} role=${u.role} logins=${u.loginCount}`;
}

function printStats(): void {
  const total = stats.hits + stats.misses;
  const hitRate = total > 0 ? ((stats.hits / total) * 100).toFixed(1) : "N/A";
  console.log(`  Hits: ${stats.hits} | Misses: ${stats.misses} | Hit rate: ${hitRate}%`);
  console.log(`  Cache writes: ${stats.writes} | Evictions: ${stats.evictions} | Stampedes prevented: ${stats.stampedePrevented}`);
  console.log(`  DB queries: ${dbQueryCount} | Cache entries: ${cache.size}`);
}

// ─── DEMO ─────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Write-Through Cache Pattern       ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Create users ──────────────────────────────────────
  console.log("=== Create Users (DB + cache populated) ===\n");

  await createUser({ id: 1, name: "Alice", email: "alice@co.com", role: "admin", loginCount: 0 });
  await createUser({ id: 2, name: "Bob", email: "bob@co.com", role: "user", loginCount: 0 });
  await createUser({ id: 3, name: "Carol", email: "carol@co.com", role: "moderator", loginCount: 0 });

  console.log("  Created 3 users (all immediately cached)");
  printStats();

  // ── Read — cache hits ─────────────────────────────────
  console.log("\n=== Read Users (all cache hits) ===\n");

  const alice = await getUser(1);
  const bob = await getUser(2);
  console.log(`  Alice: ${alice ? formatUser(alice) : "null"}`);
  console.log(`  Bob:   ${bob ? formatUser(bob) : "null"}`);
  printStats();

  // ── Write-through update ──────────────────────────────
  console.log("\n=== Update Alice (write-through) ===\n");

  await updateUser(1, { name: "Alice Johnson", role: "admin" });
  console.log("  Updated Alice in DB + cache simultaneously");

  // This read is a cache HIT — write-through kept it warm
  const aliceAfter = await getUser(1);
  console.log(`  Read after update (cache HIT): ${aliceAfter ? formatUser(aliceAfter) : "null"}`);
  console.log("\n  Compare with cache-aside:");
  console.log("    Cache-aside: update DB → invalidate cache → next read is MISS → DB query");
  console.log("    Write-through: update DB → update cache → next read is HIT (no DB query)");
  printStats();

  // ── Frequent updates (login counter) ──────────────────
  console.log("\n=== Increment Login Count (write-through advantage) ===\n");

  const beforeDbCount = dbQueryCount;
  await incrementLoginCount(2); // Bob logs in
  await incrementLoginCount(2);
  await incrementLoginCount(2);
  const bobAfter = await getUser(2); // Cache HIT
  console.log(`  Bob after 3 logins: ${bobAfter ? formatUser(bobAfter) : "null"}`);
  console.log(`  DB queries for 3 increments + 1 read: ${dbQueryCount - beforeDbCount}`);
  console.log("  (cache-aside would add 3 extra DB reads from cache misses after invalidation)");
  printStats();

  // ── TTL expiry and cache miss ─────────────────────────
  console.log("\n=== TTL Expiry (simulated) ===\n");

  // Manually expire Carol's cache entry to simulate TTL
  const carolKey = buildKey(NAMESPACE, 3);
  const entry = cache.get(carolKey);
  if (entry) entry.expiresAt = Date.now() - 1; // Force expiry

  console.log("  Expired Carol's cache entry (simulating TTL)");
  const carol = await getUser(3); // Cache MISS → DB → populate cache
  console.log(`  Read Carol (cache MISS → DB): ${carol ? formatUser(carol) : "null"}`);

  const carolAgain = await getUser(3); // Cache HIT (repopulated)
  console.log(`  Read Carol again (cache HIT): ${carolAgain ? formatUser(carolAgain) : "null"}`);
  printStats();

  // ── Stampede prevention ───────────────────────────────
  console.log("\n=== Stampede Prevention (simulated concurrent reads) ===\n");

  // Expire the cache entry
  const aliceKey = buildKey(NAMESPACE, 1);
  const aliceEntry = cache.get(aliceKey);
  if (aliceEntry) aliceEntry.expiresAt = Date.now() - 1;

  console.log("  Expired Alice's cache entry");
  console.log("  Simulating 5 concurrent reads...");

  const beforeStampedeDb = dbQueryCount;
  const results = await Promise.all([
    getUser(1),
    getUser(1),
    getUser(1),
    getUser(1),
    getUser(1),
  ]);

  console.log(`  All 5 reads returned: ${results.every((r) => r?.name === "Alice Johnson")}`);
  console.log(`  DB queries: ${dbQueryCount - beforeStampedeDb} (without lock: would be 5)`);
  printStats();

  // ── Delete ────────────────────────────────────────────
  console.log("\n=== Delete User ===\n");

  await deleteUser(3);
  const deleted = await getUser(3);
  console.log(`  Deleted Carol. Read returns: ${deleted}`);
  printStats();

  // ── Summary ───────────────────────────────────────────
  console.log("\n─────────────────────────────────────");
  console.log("Pattern Summary:");
  console.log("  READ:  cache → hit: return | miss: lock → DB → populate cache → return");
  console.log("  WRITE: update DB → update cache (not invalidate)");
  console.log("  Cache is always warm after writes (no cold-read penalty)");
  console.log("\nWhen to use write-through vs cache-aside:");
  console.log("  Write-through: data read frequently after writes, counters, hot keys");
  console.log("  Cache-aside:   data rarely re-read, simpler failure handling");
  console.log("  Both:          TTL for eviction, stampede prevention for popular keys");
}

main().catch(console.error);
