/**
 * DATALOADER PATTERN for N+1 Prevention
 *
 * DataLoader batches and deduplicates individual loads that happen
 * within a single tick of the event loop. Instead of N separate
 * queries, it collects all IDs and makes a single batched query.
 *
 * Ideal for GraphQL resolvers where each field resolver loads
 * related data independently.
 */

import { PrismaClient, User, Post } from "@prisma/client";
import DataLoader from "dataloader";

const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});

let queryCount = 0;
prisma.$on("query", () => {
  queryCount++;
});

// ─── DataLoader Factories ────────────────────────────────

/**
 * Create a DataLoader for batching user lookups by ID.
 * Collects all user IDs requested in one tick, fetches them
 * all in a single WHERE IN query.
 */
function createUserLoader() {
  return new DataLoader<number, User | null>(async (userIds) => {
    console.log(`  [UserLoader] Batched ${userIds.length} user IDs into 1 query`);

    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
    });

    // DataLoader requires results in the same order as keys
    const userMap = new Map(users.map((u) => [u.id, u]));
    return userIds.map((id) => userMap.get(id) ?? null);
  });
}

/**
 * Create a DataLoader for batching post lookups by author ID.
 * Returns an array of posts for each author.
 */
function createPostsByAuthorLoader() {
  return new DataLoader<number, Post[]>(async (authorIds) => {
    console.log(`  [PostLoader] Batched ${authorIds.length} author IDs into 1 query`);

    const posts = await prisma.post.findMany({
      where: { authorId: { in: [...authorIds] } },
    });

    // Group posts by author ID
    const postsByAuthor = new Map<number, Post[]>();
    for (const post of posts) {
      const existing = postsByAuthor.get(post.authorId) ?? [];
      existing.push(post);
      postsByAuthor.set(post.authorId, existing);
    }

    return authorIds.map((id) => postsByAuthor.get(id) ?? []);
  });
}

/**
 * Create a DataLoader for post comment counts.
 */
function createCommentCountLoader() {
  return new DataLoader<number, number>(async (postIds) => {
    console.log(`  [CommentCountLoader] Batched ${postIds.length} post IDs into 1 query`);

    const counts = await prisma.comment.groupBy({
      by: ["postId"],
      where: { postId: { in: [...postIds] } },
      _count: { id: true },
    });

    const countMap = new Map(counts.map((c) => [c.postId, c._count.id]));
    return postIds.map((id) => countMap.get(id) ?? 0);
  });
}

// ─── Per-Request Context ─────────────────────────────────

/**
 * Create fresh loaders for each request.
 * DataLoaders should NOT be shared across requests because
 * they cache results — sharing would leak data between users.
 */
function createLoaders() {
  return {
    user: createUserLoader(),
    postsByAuthor: createPostsByAuthorLoader(),
    commentCount: createCommentCountLoader(),
  };
}

// ─── Simulated GraphQL-style Resolvers ───────────────────

type Loaders = ReturnType<typeof createLoaders>;

async function resolvePostWithAuthor(post: Post, loaders: Loaders) {
  // Each resolver calls loader.load() — DataLoader batches them
  const author = await loaders.user.load(post.authorId);
  const commentCount = await loaders.commentCount.load(post.id);
  return {
    title: post.title,
    author: author?.name ?? "Unknown",
    commentCount,
  };
}

// ─── COMPARISON: Without vs With DataLoader ──────────────

async function withoutDataLoader() {
  console.log("=== WITHOUT DATALOADER ===\n");
  queryCount = 0;

  const posts = await prisma.post.findMany({ take: 10 });

  // Each iteration makes separate queries
  const results = [];
  for (const post of posts) {
    const author = await prisma.user.findUnique({
      where: { id: post.authorId },
    });
    const commentCount = await prisma.comment.count({
      where: { postId: post.id },
    });
    results.push({
      title: post.title,
      author: author?.name,
      commentCount,
    });
  }

  console.log(`Queries: ${queryCount} (1 + ${posts.length} * 2 = ${1 + posts.length * 2})`);
  return results;
}

async function withDataLoader() {
  console.log("\n=== WITH DATALOADER ===\n");
  queryCount = 0;

  const loaders = createLoaders();
  const posts = await prisma.post.findMany({ take: 10 });

  // All loads are batched — even though code looks like N+1
  const results = await Promise.all(
    posts.map((post) => resolvePostWithAuthor(post, loaders))
  );

  console.log(`Queries: ${queryCount} (1 list + 1 batch users + 1 batch counts = 3)`);
  return results;
}

// ─── DEDUPLICATION DEMO ──────────────────────────────────

async function deduplicationDemo() {
  console.log("\n=== DEDUPLICATION ===\n");
  queryCount = 0;

  const loaders = createLoaders();

  // Same user ID requested multiple times — only fetched once
  const [user1, user2, user3] = await Promise.all([
    loaders.user.load(1),
    loaders.user.load(1), // duplicate — deduped
    loaders.user.load(2),
  ]);

  console.log(`3 loads, 2 unique IDs → ${queryCount} query`);
  console.log(`user1 === user2: ${user1 === user2}`); // true — same object
}

// ─── DEMO ────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    DataLoader Pattern for N+1        ║");
  console.log("╚══════════════════════════════════════╝\n");

  const without = await withoutDataLoader();
  const withDL = await withDataLoader();
  await deduplicationDemo();

  console.log("\n─────────────────────────────────────");
  console.log("SUMMARY");
  console.log("─────────────────────────────────────");
  console.log("Without DataLoader: O(N) queries per relation");
  console.log("With DataLoader:    O(1) queries per relation (batched)");
  console.log("Bonus:              Automatic deduplication of repeated IDs");
  console.log("\nBest used in GraphQL resolvers where each field");
  console.log("resolver independently loads related data.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
