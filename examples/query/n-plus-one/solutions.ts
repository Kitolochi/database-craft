/**
 * N+1 SOLUTIONS
 *
 * Three approaches to eliminate N+1 queries:
 * 1. Prisma `include` / `select` — eager loading
 * 2. Prisma `_count` — aggregation without loading
 * 3. Drizzle joins — SQL-level joins
 *
 * Each reduces N+1 queries to 1-2 queries regardless of data size.
 */

import { PrismaClient } from "@prisma/client";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql, count } from "drizzle-orm";
import {
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import postgres from "postgres";

const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});

let queryCount = 0;
prisma.$on("query", () => {
  queryCount++;
});

function resetQueryCount() {
  queryCount = 0;
}

// ─── SOLUTION 1: Prisma include (eager loading) ─────────

async function getPostsWithAuthorsGood() {
  console.log("=== SOLUTION 1: Prisma include ===\n");
  resetQueryCount();

  // Single query with JOIN — Prisma generates efficient SQL
  const posts = await prisma.post.findMany({
    take: 20,
    include: {
      author: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  console.log(`Total queries: ${queryCount} (vs N+1 = ${1 + posts.length})`);
  posts.slice(0, 3).forEach((p) =>
    console.log(`  "${p.title}" by ${p.author.name}`)
  );
  return posts;
}

// ─── SOLUTION 2: Prisma _count (aggregation) ─────────────

async function getAuthorsWithPostCountsGood() {
  console.log("\n=== SOLUTION 2: Prisma _count ===\n");
  resetQueryCount();

  // Uses a single query with subquery for count
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      _count: {
        select: { posts: true, comments: true },
      },
    },
  });

  console.log(`Total queries: ${queryCount} (vs N+1 = ${1 + users.length})`);
  users.forEach((u) =>
    console.log(`  ${u.name}: ${u._count.posts} posts, ${u._count.comments} comments`)
  );
  return users;
}

// ─── SOLUTION 3: Prisma nested include (deep eager load) ─

async function getPostsWithEverythingGood() {
  console.log("\n=== SOLUTION 3: Deep eager loading ===\n");
  resetQueryCount();

  const posts = await prisma.post.findMany({
    take: 10,
    include: {
      author: { select: { name: true } },
      comments: {
        include: {
          author: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { comments: true } },
    },
  });

  console.log(`Total queries: ${queryCount} (vs exponential N+1)`);
  posts.slice(0, 3).forEach((p) => {
    console.log(`  "${p.title}" by ${p.author.name} (${p._count.comments} comments)`);
    p.comments.slice(0, 2).forEach((c) =>
      console.log(`    └─ ${c.author.name}: "${c.body.slice(0, 40)}..."`)
    );
  });
  return posts;
}

// ─── SOLUTION 4: Drizzle with SQL JOIN ───────────────────

// Minimal Drizzle schema for this example
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
});

const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  published: boolean("published").default(false).notNull(),
  viewCount: integer("view_count").default(0).notNull(),
  authorId: integer("author_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

async function getPostsWithAuthorsDrizzle() {
  console.log("\n=== SOLUTION 4: Drizzle SQL JOIN ===\n");

  const connectionString = process.env.DATABASE_URL!;
  const queryClient = postgres(connectionString);
  const db = drizzle(queryClient);

  // Single SQL query with explicit JOIN
  const result = await db
    .select({
      postId: posts.id,
      postTitle: posts.title,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(eq(posts.published, true))
    .limit(20);

  console.log(`Single query with JOIN (always 1 query)`);
  result.slice(0, 3).forEach((r) =>
    console.log(`  "${r.postTitle}" by ${r.authorName}`)
  );

  // GROUP BY for counts — also a single query
  const authorCounts = await db
    .select({
      authorName: users.name,
      postCount: count(posts.id),
    })
    .from(users)
    .leftJoin(posts, eq(users.id, posts.authorId))
    .groupBy(users.id, users.name);

  console.log("\nAuthor post counts (single GROUP BY query):");
  authorCounts.forEach((a) =>
    console.log(`  ${a.authorName}: ${a.postCount} posts`)
  );

  await queryClient.end();
  return result;
}

// ─── COMPARISON SUMMARY ─────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║      N+1 Solutions Comparison        ║");
  console.log("╚══════════════════════════════════════╝\n");

  const s1 = await getPostsWithAuthorsGood();
  const s2 = await getAuthorsWithPostCountsGood();
  const s3 = await getPostsWithEverythingGood();
  await getPostsWithAuthorsDrizzle();

  console.log("\n─────────────────────────────────────");
  console.log("SUMMARY: Query Count Comparison");
  console.log("─────────────────────────────────────");
  console.log(`Posts + Authors:     N+1 = ${1 + s1.length} queries → Solution: 1-2 queries`);
  console.log(`Users + Post Count:  N+1 = ${1 + s2.length} queries → Solution: 1 query`);
  console.log(`Nested relations:    Exponential      → Solution: 2-4 queries`);
  console.log(`Drizzle JOIN:        Always 1 query`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
