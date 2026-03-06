import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["query"],
});

// ─── CREATE ──────────────────────────────────────────────

async function createUser(data: { email: string; name: string; bio?: string }) {
  return prisma.user.create({
    data,
    select: { id: true, email: true, name: true, createdAt: true },
  });
}

async function createPostWithTags(
  authorId: number,
  data: { title: string; content: string; tagNames: string[] }
) {
  return prisma.post.create({
    data: {
      title: data.title,
      content: data.content,
      authorId,
      tags: {
        create: data.tagNames.map((name) => ({
          tag: {
            connectOrCreate: {
              where: { name },
              create: { name },
            },
          },
        })),
      },
    },
    include: {
      author: { select: { name: true } },
      tags: { include: { tag: true } },
    },
  });
}

// ─── READ with Pagination & Filtering ────────────────────

interface PostFilters {
  published?: boolean;
  authorId?: number;
  search?: string;
  tagName?: string;
}

interface PaginationOptions {
  page: number;
  pageSize: number;
  orderBy?: "recent" | "popular";
}

async function getPosts(filters: PostFilters, pagination: PaginationOptions) {
  const { page, pageSize, orderBy = "recent" } = pagination;
  const skip = (page - 1) * pageSize;

  const where: Prisma.PostWhereInput = {};

  if (filters.published !== undefined) {
    where.published = filters.published;
  }
  if (filters.authorId) {
    where.authorId = filters.authorId;
  }
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" } },
      { content: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.tagName) {
    where.tags = { some: { tag: { name: filters.tagName } } };
  }

  const orderByClause: Prisma.PostOrderByWithRelationInput =
    orderBy === "popular" ? { viewCount: "desc" } : { createdAt: "desc" };

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: orderByClause,
      skip,
      take: pageSize,
      include: {
        author: { select: { id: true, name: true } },
        tags: { include: { tag: { select: { name: true } } } },
        _count: { select: { comments: true } },
      },
    }),
    prisma.post.count({ where }),
  ]);

  return {
    data: posts,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: skip + pageSize < total,
      hasPrev: page > 1,
    },
  };
}

async function getUserWithPosts(userId: number) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      posts: {
        where: { published: true },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { comments: true } },
        },
      },
      _count: { select: { posts: true, comments: true } },
    },
  });
}

// ─── UPDATE ──────────────────────────────────────────────

async function publishPost(postId: number) {
  return prisma.post.update({
    where: { id: postId },
    data: { published: true },
    select: { id: true, title: true, published: true },
  });
}

async function incrementViewCount(postId: number) {
  return prisma.post.update({
    where: { id: postId },
    data: { viewCount: { increment: 1 } },
    select: { id: true, viewCount: true },
  });
}

async function updateUserProfile(
  userId: number,
  data: { name?: string; bio?: string }
) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, bio: true, updatedAt: true },
  });
}

// ─── DELETE ──────────────────────────────────────────────

async function deletePost(postId: number) {
  return prisma.post.delete({
    where: { id: postId },
    select: { id: true, title: true },
  });
}

async function deactivateUser(userId: number) {
  return prisma.user.update({
    where: { id: userId },
    data: { active: false },
  });
}

// ─── TRANSACTIONS ────────────────────────────────────────

async function transferPostOwnership(postId: number, newAuthorId: number) {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.findUniqueOrThrow({
      where: { id: postId },
      select: { id: true, title: true, authorId: true },
    });

    const newAuthor = await tx.user.findUniqueOrThrow({
      where: { id: newAuthorId },
      select: { id: true, name: true, active: true },
    });

    if (!newAuthor.active) {
      throw new Error(`User ${newAuthor.name} is deactivated`);
    }

    return tx.post.update({
      where: { id: postId },
      data: { authorId: newAuthorId },
      include: {
        author: { select: { name: true } },
      },
    });
  });
}

async function createUserWithFirstPost(userData: {
  email: string;
  name: string;
  postTitle: string;
  postContent: string;
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: userData.email,
        name: userData.name,
      },
    });

    const post = await tx.post.create({
      data: {
        title: userData.postTitle,
        content: userData.postContent,
        authorId: user.id,
        published: true,
      },
    });

    return { user, post };
  });
}

// ─── DEMO ────────────────────────────────────────────────

async function main() {
  console.log("=== Prisma CRUD Demo ===\n");

  // Create
  console.log("--- CREATE ---");
  const user = await createUser({
    email: "demo@example.com",
    name: "Demo User",
  });
  console.log("Created user:", user);

  const post = await createPostWithTags(user.id, {
    title: "My First Post",
    content: "Hello from Prisma!",
    tagNames: ["prisma", "hello-world"],
  });
  console.log("Created post with tags:", post.title, post.tags);

  // Read with pagination
  console.log("\n--- READ (paginated, filtered) ---");
  const result = await getPosts(
    { published: true },
    { page: 1, pageSize: 5, orderBy: "popular" }
  );
  console.log(`Found ${result.pagination.total} published posts`);
  result.data.forEach((p) =>
    console.log(`  - "${p.title}" by ${p.author.name} (${p._count.comments} comments)`)
  );

  // Update
  console.log("\n--- UPDATE ---");
  const published = await publishPost(post.id);
  console.log("Published:", published);

  const viewed = await incrementViewCount(post.id);
  console.log("View count:", viewed);

  // Transaction
  console.log("\n--- TRANSACTION ---");
  const { user: newUser, post: newPost } = await createUserWithFirstPost({
    email: "transactional@example.com",
    name: "Transaction User",
    postTitle: "Created Atomically",
    postContent: "This user and post were created in a single transaction.",
  });
  console.log(`User ${newUser.name} and post "${newPost.title}" created atomically`);

  // Cleanup demo data
  console.log("\n--- DELETE ---");
  const deleted = await deletePost(post.id);
  console.log("Deleted post:", deleted);
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.post.deleteMany({ where: { authorId: newUser.id } });
  await prisma.user.delete({ where: { id: newUser.id } });
  console.log("Cleaned up demo data");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
