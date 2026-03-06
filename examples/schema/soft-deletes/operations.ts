import { PrismaClient } from "@prisma/client";
import {
  applySoftDeleteMiddleware,
  restoreRecord,
  purgeDeletedRecords,
  findDeletedRecords,
} from "./soft-delete.middleware";

const prisma = new PrismaClient({ log: ["query"] });

// Apply the soft-delete middleware
applySoftDeleteMiddleware(prisma);

async function main() {
  console.log("=== Soft Delete Pattern Demo ===\n");

  // Setup: create test data
  console.log("--- SETUP ---");
  const user = await prisma.user.create({
    data: {
      email: "alice@example.com",
      name: "Alice",
      posts: {
        create: [
          { title: "Post 1", content: "First post content" },
          { title: "Post 2", content: "Second post content" },
          { title: "Post 3", content: "Third post content" },
        ],
      },
    },
    include: { posts: true },
  });
  console.log(`Created user with ${user.posts.length} posts`);

  // ─── Soft Delete ───────────────────────────────────

  console.log("\n--- SOFT DELETE ---");

  // Delete a post (middleware converts to soft delete)
  await prisma.post.delete({ where: { id: user.posts[0].id } });
  console.log(`Soft-deleted post: "${user.posts[0].title}"`);

  // Verify it's hidden from normal queries
  const visiblePosts = await prisma.post.findMany({
    where: { authorId: user.id },
  });
  console.log(`Visible posts after delete: ${visiblePosts.length} (was 3)`);

  // Count also respects soft delete
  const postCount = await prisma.post.count({
    where: { authorId: user.id },
  });
  console.log(`Post count: ${postCount}`);

  // ─── View Deleted Records (admin) ──────────────────

  console.log("\n--- VIEW DELETED ---");
  const deletedPosts = await findDeletedRecords(prisma, "Post");
  console.log(`Found ${deletedPosts.length} soft-deleted post(s):`);
  deletedPosts.forEach((p) =>
    console.log(`  - "${p.title}" deleted at ${p.deletedAt}`)
  );

  // ─── Restore ───────────────────────────────────────

  console.log("\n--- RESTORE ---");
  await restoreRecord(prisma, "Post", user.posts[0].id);
  console.log(`Restored post: "${user.posts[0].title}"`);

  const afterRestore = await prisma.post.findMany({
    where: { authorId: user.id },
  });
  console.log(`Visible posts after restore: ${afterRestore.length}`);

  // ─── Bulk Soft Delete ──────────────────────────────

  console.log("\n--- BULK SOFT DELETE ---");
  await prisma.post.deleteMany({ where: { authorId: user.id } });
  console.log("Soft-deleted all user's posts");

  const afterBulk = await prisma.post.findMany({
    where: { authorId: user.id },
  });
  console.log(`Visible posts after bulk delete: ${afterBulk.length}`);

  // ─── Purge (permanent delete) ──────────────────────

  console.log("\n--- PURGE ---");
  // For demo, purge with 0-day retention (purge everything)
  const purged = await purgeDeletedRecords(prisma, 0);
  console.log(
    `Permanently purged: ${purged.purgedPosts} posts, ${purged.purgedUsers} users`
  );

  // ─── User Soft Delete ─────────────────────────────

  console.log("\n--- USER SOFT DELETE ---");
  await prisma.user.delete({ where: { id: user.id } });
  console.log("Soft-deleted user");

  const findUser = await prisma.user.findFirst({
    where: { email: "alice@example.com" },
  });
  console.log(`User visible after delete: ${findUser !== null}`);

  const deletedUsers = await findDeletedRecords(prisma, "User");
  console.log(`Found ${deletedUsers.length} soft-deleted user(s)`);

  // Cleanup: permanent purge
  await purgeDeletedRecords(prisma, 0);
  console.log("\nCleanup complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
