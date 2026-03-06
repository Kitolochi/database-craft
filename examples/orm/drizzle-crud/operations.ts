import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, or, ilike, desc, asc, sql, count } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const queryClient = postgres(connectionString);
const db = drizzle(queryClient, { schema });

// ─── INSERT ──────────────────────────────────────────────

async function createUser(data: schema.NewUser) {
  const [user] = await db.insert(schema.users).values(data).returning();
  return user;
}

async function createPost(data: schema.NewPost) {
  const [post] = await db.insert(schema.posts).values(data).returning();
  return post;
}

async function createManyUsers(data: schema.NewUser[]) {
  return db.insert(schema.users).values(data).returning();
}

// ─── SELECT with WHERE, JOIN, pagination ─────────────────

async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  return user;
}

async function getPublishedPosts(page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;

  const [postsResult, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.posts.id,
        title: schema.posts.title,
        viewCount: schema.posts.viewCount,
        createdAt: schema.posts.createdAt,
        authorName: schema.users.name,
        authorEmail: schema.users.email,
      })
      .from(schema.posts)
      .innerJoin(schema.users, eq(schema.posts.authorId, schema.users.id))
      .where(eq(schema.posts.published, true))
      .orderBy(desc(schema.posts.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(schema.posts)
      .where(eq(schema.posts.published, true)),
  ]);

  return {
    data: postsResult,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

async function searchPosts(query: string) {
  return db
    .select({
      id: schema.posts.id,
      title: schema.posts.title,
      authorName: schema.users.name,
    })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.posts.authorId, schema.users.id))
    .where(
      and(
        eq(schema.posts.published, true),
        or(
          ilike(schema.posts.title, `%${query}%`),
          ilike(schema.posts.content, `%${query}%`)
        )
      )
    )
    .orderBy(desc(schema.posts.viewCount));
}

async function getPostWithComments(postId: number) {
  return db
    .select({
      postTitle: schema.posts.title,
      postContent: schema.posts.content,
      commentBody: schema.comments.body,
      commentAuthor: schema.users.name,
      commentedAt: schema.comments.createdAt,
    })
    .from(schema.posts)
    .leftJoin(schema.comments, eq(schema.comments.postId, schema.posts.id))
    .leftJoin(schema.users, eq(schema.comments.authorId, schema.users.id))
    .where(eq(schema.posts.id, postId))
    .orderBy(asc(schema.comments.createdAt));
}

// Relational query API (requires schema with relations)
async function getUserWithAllData(userId: number) {
  return db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    with: {
      posts: {
        where: eq(schema.posts.published, true),
        orderBy: [desc(schema.posts.createdAt)],
        with: {
          comments: {
            with: {
              author: { columns: { name: true } },
            },
          },
        },
      },
    },
  });
}

// ─── UPDATE ──────────────────────────────────────────────

async function publishPost(postId: number) {
  const [post] = await db
    .update(schema.posts)
    .set({ published: true, updatedAt: new Date() })
    .where(eq(schema.posts.id, postId))
    .returning({ id: schema.posts.id, title: schema.posts.title });
  return post;
}

async function incrementViews(postId: number) {
  const [post] = await db
    .update(schema.posts)
    .set({ viewCount: sql`${schema.posts.viewCount} + 1` })
    .where(eq(schema.posts.id, postId))
    .returning({ id: schema.posts.id, viewCount: schema.posts.viewCount });
  return post;
}

async function deactivateUser(userId: number) {
  const [user] = await db
    .update(schema.users)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(schema.users.id, userId))
    .returning();
  return user;
}

// ─── DELETE ──────────────────────────────────────────────

async function deletePost(postId: number) {
  const [deleted] = await db
    .delete(schema.posts)
    .where(eq(schema.posts.id, postId))
    .returning({ id: schema.posts.id, title: schema.posts.title });
  return deleted;
}

async function deleteUserCascade(userId: number) {
  // Comments and posts cascade-delete via FK constraints
  const [deleted] = await db
    .delete(schema.users)
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id, email: schema.users.email });
  return deleted;
}

// ─── TRANSACTIONS ────────────────────────────────────────

async function transferPostOwnership(postId: number, newAuthorId: number) {
  return db.transaction(async (tx) => {
    const [post] = await tx
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.id, postId))
      .limit(1);

    if (!post) throw new Error(`Post ${postId} not found`);

    const [newAuthor] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, newAuthorId))
      .limit(1);

    if (!newAuthor) throw new Error(`User ${newAuthorId} not found`);
    if (!newAuthor.active) throw new Error(`User ${newAuthor.name} is deactivated`);

    const [updated] = await tx
      .update(schema.posts)
      .set({ authorId: newAuthorId, updatedAt: new Date() })
      .where(eq(schema.posts.id, postId))
      .returning();

    return updated;
  });
}

// ─── DEMO ────────────────────────────────────────────────

async function main() {
  console.log("=== Drizzle CRUD Demo ===\n");

  // Insert
  console.log("--- INSERT ---");
  const alice = await createUser({
    email: "alice@drizzle.dev",
    name: "Alice",
    bio: "Drizzle enthusiast",
  });
  console.log("Created user:", alice);

  const post = await createPost({
    title: "Getting Started with Drizzle",
    content: "Drizzle ORM provides a SQL-like TypeScript API...",
    authorId: alice.id,
    published: true,
  });
  console.log("Created post:", post.title);

  // Select with join
  console.log("\n--- SELECT with JOIN ---");
  const published = await getPublishedPosts(1, 10);
  console.log(`Page 1 of ${published.pagination.totalPages}:`);
  published.data.forEach((p) =>
    console.log(`  - "${p.title}" by ${p.authorName}`)
  );

  // Search
  console.log("\n--- SEARCH ---");
  const results = await searchPosts("drizzle");
  console.log(`Found ${results.length} posts matching "drizzle"`);

  // Relational query
  console.log("\n--- RELATIONAL QUERY ---");
  const userWithData = await getUserWithAllData(alice.id);
  console.log("User with nested data:", JSON.stringify(userWithData, null, 2));

  // Update
  console.log("\n--- UPDATE ---");
  const viewed = await incrementViews(post.id);
  console.log("Incremented views:", viewed);

  // Delete
  console.log("\n--- DELETE ---");
  const deleted = await deletePost(post.id);
  console.log("Deleted:", deleted);
  await deleteUserCascade(alice.id);
  console.log("Cleaned up demo data");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
