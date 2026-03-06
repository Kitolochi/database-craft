import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import {
  createUsers,
  createPosts,
  createComment,
  createTags,
} from "./factories";

const prisma = new PrismaClient();

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// ─── Development Seed ────────────────────────────────────

async function seedDevelopment() {
  console.log("Seeding development database...\n");

  // Set a fixed seed for reproducible fake data across runs
  faker.seed(42);

  // Create tags
  const tags = await createTags([
    "typescript",
    "javascript",
    "prisma",
    "drizzle",
    "postgresql",
    "redis",
    "docker",
    "testing",
    "performance",
    "security",
  ]);
  console.log(`  Created ${tags.length} tags`);

  // Create users
  const users = await createUsers(20);
  console.log(`  Created ${users.length} users`);

  // Create posts for each user
  let postCount = 0;
  let commentCount = 0;

  for (const user of users) {
    const numPosts = faker.number.int({ min: 0, max: 5 });
    const posts = await createPosts(user.id, numPosts);
    postCount += posts.length;

    // Add comments from random other users
    for (const post of posts) {
      const numComments = faker.number.int({ min: 0, max: 4 });
      for (let i = 0; i < numComments; i++) {
        const randomUser = users[faker.number.int({ min: 0, max: users.length - 1 })];
        await createComment(post.id, randomUser.id);
        commentCount++;
      }
    }
  }

  console.log(`  Created ${postCount} posts`);
  console.log(`  Created ${commentCount} comments`);
  console.log("\nDevelopment seed complete.");
}

// ─── Production Seed (Idempotent) ────────────────────────

/**
 * Production seeds must be idempotent — safe to run multiple times.
 * Use upsert for lookup data that must exist.
 * Never create test/fake data in production.
 */
async function seedProduction() {
  console.log("Seeding production database (idempotent)...\n");

  // Seed required lookup data using upsert
  const requiredTags = [
    "announcement",
    "feature",
    "bugfix",
    "documentation",
    "discussion",
  ];

  for (const name of requiredTags) {
    await prisma.tag.upsert({
      where: { name },
      update: {}, // No-op if already exists
      create: { name },
    });
  }
  console.log(`  Upserted ${requiredTags.length} required tags`);

  // Seed system user (for automated posts, system comments, etc.)
  const systemUser = await prisma.user.upsert({
    where: { email: "system@app.internal" },
    update: {},
    create: {
      email: "system@app.internal",
      name: "System",
      bio: "Automated system account",
    },
  });
  console.log(`  System user: ${systemUser.email} (id: ${systemUser.id})`);

  // Seed admin user (create only if not exists)
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: "Admin",
      bio: "Platform administrator",
    },
  });
  console.log(`  Admin user: ${adminUser.email} (id: ${adminUser.id})`);

  console.log("\nProduction seed complete (idempotent, safe to re-run).");
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║         Database Seed Script         ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`Environment: ${IS_PRODUCTION ? "PRODUCTION" : "development"}\n`);

  if (IS_PRODUCTION) {
    await seedProduction();
  } else {
    await seedDevelopment();
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
