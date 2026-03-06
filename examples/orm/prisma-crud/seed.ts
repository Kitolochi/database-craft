import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed() {
  // Clean existing data in dependency order
  await prisma.tagsOnPosts.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany();

  // Create tags
  const tags = await Promise.all(
    ["typescript", "prisma", "database", "tutorial", "advanced"].map((name) =>
      prisma.tag.create({ data: { name } })
    )
  );

  // Create users with posts and comments in a single transaction
  const [alice, bob, charlie] = await prisma.$transaction([
    prisma.user.create({
      data: {
        email: "alice@example.com",
        name: "Alice Johnson",
        bio: "Full-stack developer who loves TypeScript",
        posts: {
          create: [
            {
              title: "Getting Started with Prisma",
              content:
                "Prisma is a next-generation ORM for Node.js and TypeScript...",
              published: true,
              viewCount: 1250,
              tags: {
                create: [
                  { tag: { connect: { id: tags[1].id } } },
                  { tag: { connect: { id: tags[3].id } } },
                ],
              },
            },
            {
              title: "Advanced Prisma Patterns",
              content:
                "Once you master the basics, these patterns will level up your Prisma usage...",
              published: true,
              viewCount: 830,
              tags: {
                create: [
                  { tag: { connect: { id: tags[1].id } } },
                  { tag: { connect: { id: tags[4].id } } },
                ],
              },
            },
            {
              title: "Draft: Prisma vs Drizzle",
              content: "Work in progress comparison...",
              published: false,
            },
          ],
        },
      },
    }),
    prisma.user.create({
      data: {
        email: "bob@example.com",
        name: "Bob Smith",
        bio: "Backend engineer specializing in databases",
        posts: {
          create: [
            {
              title: "Database Indexing Deep Dive",
              content:
                "Understanding B-tree indexes and when to use them...",
              published: true,
              viewCount: 2100,
              tags: {
                create: [
                  { tag: { connect: { id: tags[2].id } } },
                  { tag: { connect: { id: tags[4].id } } },
                ],
              },
            },
          ],
        },
      },
    }),
    prisma.user.create({
      data: {
        email: "charlie@example.com",
        name: "Charlie Lee",
        active: true,
      },
    }),
  ]);

  // Add cross-user comments
  const alicePosts = await prisma.post.findMany({
    where: { authorId: alice.id },
  });
  const bobPosts = await prisma.post.findMany({
    where: { authorId: bob.id },
  });

  await prisma.comment.createMany({
    data: [
      {
        body: "Great introduction! Very helpful.",
        postId: alicePosts[0].id,
        authorId: bob.id,
      },
      {
        body: "Thanks Bob! Glad you found it useful.",
        postId: alicePosts[0].id,
        authorId: alice.id,
      },
      {
        body: "This indexing guide saved me hours of debugging.",
        postId: bobPosts[0].id,
        authorId: charlie.id,
      },
    ],
  });

  console.log("Seed complete:");
  console.log(`  ${3} users created`);
  console.log(`  ${alicePosts.length + bobPosts.length} posts created`);
  console.log(`  ${tags.length} tags created`);
  console.log(`  3 comments created`);
}

seed()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
