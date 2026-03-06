/**
 * N+1 PROBLEM DEMONSTRATION
 *
 * The N+1 problem occurs when code fetches a list of N records,
 * then makes an additional query for each record to load related data.
 * This results in 1 (list) + N (per-item) = N+1 queries.
 *
 * With 100 users, that's 101 queries instead of 1 or 2.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});

// Track query count
let queryCount = 0;
prisma.$on("query", () => {
  queryCount++;
});

function resetQueryCount() {
  queryCount = 0;
}

// ─── THE PROBLEM: N+1 queries in a loop ──────────────────

async function getAuthorsWithPostCountsBad() {
  console.log("=== N+1 PROBLEM ===\n");
  resetQueryCount();

  // Query 1: Get all users
  const users = await prisma.user.findMany();

  // Queries 2..N+1: One query PER user to count their posts
  const results = [];
  for (const user of users) {
    const postCount = await prisma.post.count({
      where: { authorId: user.id },
    });
    results.push({ name: user.name, postCount });
  }

  console.log(`Total queries: ${queryCount} (1 + ${users.length} = N+1 problem!)`);
  console.log("Results:", results);
  return results;
}

// ─── ANOTHER COMMON N+1: Lazy loading relations ─────────

async function getPostsWithAuthorsBad() {
  console.log("\n=== N+1 PROBLEM (lazy loading) ===\n");
  resetQueryCount();

  // Query 1: Get all posts
  const posts = await prisma.post.findMany({ take: 20 });

  // Queries 2..N+1: Load each author individually
  const results = [];
  for (const post of posts) {
    const author = await prisma.user.findUnique({
      where: { id: post.authorId },
    });
    results.push({
      title: post.title,
      author: author?.name,
    });
  }

  console.log(`Total queries: ${queryCount} (expected: ${1 + posts.length})`);
  console.log("Results:", results.slice(0, 3), "...");
  return results;
}

// ─── NESTED N+1: Even worse ──────────────────────────────

async function getPostsWithAuthorsAndCommentsBad() {
  console.log("\n=== NESTED N+1 PROBLEM ===\n");
  resetQueryCount();

  // Query 1: Get posts
  const posts = await prisma.post.findMany({ take: 10 });

  const results = [];
  for (const post of posts) {
    // N queries: Load author
    const author = await prisma.user.findUnique({
      where: { id: post.authorId },
    });

    // N more queries: Load comments
    const comments = await prisma.comment.findMany({
      where: { postId: post.id },
    });

    // N * M queries: Load comment authors
    const commentAuthors = [];
    for (const comment of comments) {
      const commentAuthor = await prisma.user.findUnique({
        where: { id: comment.authorId },
      });
      commentAuthors.push(commentAuthor?.name);
    }

    results.push({
      title: post.title,
      author: author?.name,
      commentCount: comments.length,
    });
  }

  console.log(`Total queries: ${queryCount} (exponential N+1!)`);
  return results;
}

// ─── DEMO ────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   N+1 Query Problem Demonstration    ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log("Watch the query count grow with each pattern.\n");

  await getAuthorsWithPostCountsBad();
  await getPostsWithAuthorsBad();
  await getPostsWithAuthorsAndCommentsBad();

  console.log("\n─────────────────────────────────────");
  console.log("Run `ts-node solutions.ts` to see the fixes.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
