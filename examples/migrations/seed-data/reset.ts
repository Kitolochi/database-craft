import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Reset the database by truncating all tables.
 * Uses TRUNCATE CASCADE for speed (vs DELETE which fires triggers).
 *
 * DANGER: This permanently deletes all data. Development only.
 */
async function resetDatabase() {
  if (process.env.NODE_ENV === "production") {
    console.error("REFUSING to reset production database.");
    console.error("Set NODE_ENV to something other than 'production' to proceed.");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════╗");
  console.log("║       Database Reset Script          ║");
  console.log("╚══════════════════════════════════════╝\n");

  console.log("Truncating all tables...\n");

  // Order matters — truncate in reverse dependency order
  // Or use CASCADE to handle it automatically
  const tablesToTruncate = [
    "tags_on_posts",
    "comments",
    "posts",
    "tags",
    "users",
  ];

  for (const table of tablesToTruncate) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`
    );
    console.log(`  Truncated: ${table}`);
  }

  console.log("\nAll tables truncated. Run `npm run seed` to repopulate.");
}

/**
 * Selective reset — only delete data matching a condition.
 * Useful for cleaning up test data without affecting seed data.
 */
async function resetTestData() {
  console.log("Cleaning up test data...\n");

  // Delete users with @test.com email and their cascade data
  const result = await prisma.user.deleteMany({
    where: {
      email: { contains: "@test.com" },
    },
  });

  console.log(`  Deleted ${result.count} test users (and cascaded data)`);
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2];

  switch (mode) {
    case "--test-only":
      await resetTestData();
      break;
    case "--full":
    default:
      await resetDatabase();
      break;
  }
}

main()
  .catch((e) => {
    console.error("Reset failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
