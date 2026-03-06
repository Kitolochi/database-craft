import { PrismaClient } from "@prisma/client";
import { CacheService } from "./cache.service";

const prisma = new PrismaClient();
const cache = new CacheService({
  defaultTTL: 600, // 10 minutes
  keyPrefix: "app",
});

const NAMESPACE = "user";

interface UserData {
  id: number;
  email: string;
  name: string;
  bio: string | null;
  postCount: number;
}

// ─── READ: Cache-Aside Pattern ───────────────────────────

/**
 * Get user by ID using cache-aside pattern.
 *
 * Flow:
 *   1. Check Redis cache for `app:user:{id}`
 *   2. Cache HIT  → return cached data (fast path)
 *   3. Cache MISS → query Prisma → store in Redis with TTL → return
 */
async function getUserById(userId: number): Promise<UserData | null> {
  const { data, fromCache } = await cache.getOrFetch<UserData>(
    NAMESPACE,
    userId,
    async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          bio: true,
          _count: { select: { posts: true } },
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        bio: user.bio,
        postCount: user._count.posts,
      };
    },
    600 // 10 minute TTL
  );

  console.log(`getUserById(${userId}): ${fromCache ? "CACHE HIT" : "CACHE MISS → DB query"}`);
  return data;
}

/**
 * Get user by email — uses email as cache key.
 */
async function getUserByEmail(email: string): Promise<UserData | null> {
  const { data, fromCache } = await cache.getOrFetch<UserData>(
    `${NAMESPACE}:email`,
    email,
    async () => {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          bio: true,
          _count: { select: { posts: true } },
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        bio: user.bio,
        postCount: user._count.posts,
      };
    }
  );

  console.log(`getUserByEmail(${email}): ${fromCache ? "CACHE HIT" : "CACHE MISS → DB query"}`);
  return data;
}

// ─── WRITE: Update DB → Invalidate Cache ─────────────────

/**
 * Update user profile.
 *
 * Flow:
 *   1. Update the database (source of truth)
 *   2. Invalidate ALL cache entries for this user
 *      (by ID and by email to avoid stale data)
 *
 * We invalidate rather than update-in-place because:
 *   - Simpler to reason about
 *   - Avoids race conditions between concurrent writes
 *   - Next read will populate fresh data
 */
async function updateUser(
  userId: number,
  data: { name?: string; bio?: string }
): Promise<UserData> {
  // 1. Update database first
  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      bio: true,
      _count: { select: { posts: true } },
    },
  });

  // 2. Invalidate cache entries (both by ID and by email)
  await Promise.all([
    cache.invalidate(NAMESPACE, userId),
    cache.invalidate(`${NAMESPACE}:email`, user.email),
  ]);

  console.log(`updateUser(${userId}): DB updated, cache invalidated`);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    bio: user.bio,
    postCount: user._count.posts,
  };
}

/**
 * Delete user — remove from DB and cache.
 */
async function deleteUser(userId: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  await prisma.user.delete({ where: { id: userId } });

  // Invalidate all related cache entries
  await Promise.all([
    cache.invalidate(NAMESPACE, userId),
    user ? cache.invalidate(`${NAMESPACE}:email`, user.email) : Promise.resolve(),
  ]);

  console.log(`deleteUser(${userId}): DB deleted, cache invalidated`);
}

// ─── Bulk Invalidation ───────────────────────────────────

/**
 * After a bulk operation (e.g., admin role change affecting many users),
 * invalidate the entire user namespace.
 */
async function invalidateAllUserCaches(): Promise<void> {
  const count = await cache.invalidateNamespace(NAMESPACE);
  const emailCount = await cache.invalidateNamespace(`${NAMESPACE}:email`);
  console.log(`Invalidated ${count + emailCount} cached user entries`);
}

// ─── DEMO ────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Redis Cache-Aside Pattern Demo    ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Assumes seed data exists with user ID 1
  const userId = 1;

  // First call: cache MISS → queries DB, populates cache
  console.log("--- First read (cache miss) ---");
  const user1 = await getUserById(userId);
  console.log("Result:", user1);

  // Second call: cache HIT → returns from Redis
  console.log("\n--- Second read (cache hit) ---");
  const user2 = await getUserById(userId);
  console.log("Result:", user2);

  // Update: DB write → cache invalidation
  console.log("\n--- Update (invalidates cache) ---");
  if (user1) {
    await updateUser(userId, { name: "Alice Updated" });
  }

  // Next read: cache MISS again (was invalidated) → re-fetches from DB
  console.log("\n--- Read after update (cache miss) ---");
  const user3 = await getUserById(userId);
  console.log("Result:", user3);

  // Cache stats
  console.log("\n--- Cache Stats ---");
  const stats = await cache.getStats();
  console.log(stats);

  console.log("\n─────────────────────────────────────");
  console.log("Pattern Summary:");
  console.log("  READ:  cache.get → miss → db.query → cache.set");
  console.log("  WRITE: db.update → cache.invalidate");
  console.log("  Never update cache directly on writes.");
  console.log("  Let the next read re-populate it.");
}

main()
  .catch(console.error)
  .finally(async () => {
    await cache.disconnect();
    await prisma.$disconnect();
  });
