import { faker } from "@faker-js/faker";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Types ───────────────────────────────────────────────

type UserOverrides = Partial<Prisma.UserCreateInput>;
type PostOverrides = Partial<Omit<Prisma.PostCreateInput, "author">> & {
  authorId?: number;
};
type CommentOverrides = Partial<Omit<Prisma.CommentCreateInput, "post" | "author">> & {
  postId?: number;
  authorId?: number;
};

// ─── User Factory ────────────────────────────────────────

function buildUser(overrides: UserOverrides = {}): Prisma.UserCreateInput {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  return {
    email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    name: `${firstName} ${lastName}`,
    bio: faker.person.bio(),
    active: true,
    ...overrides,
  };
}

async function createUser(overrides: UserOverrides = {}) {
  return prisma.user.create({ data: buildUser(overrides) });
}

async function createUsers(count: number, overrides: UserOverrides = {}) {
  const users = Array.from({ length: count }, () => buildUser(overrides));
  return prisma.user.createManyAndReturn({ data: users });
}

// ─── Post Factory ────────────────────────────────────────

function buildPost(authorId: number, overrides: PostOverrides = {}): Prisma.PostCreateInput {
  const { authorId: _, ...rest } = overrides;

  return {
    title: faker.lorem.sentence({ min: 3, max: 8 }),
    content: faker.lorem.paragraphs({ min: 2, max: 5 }),
    published: faker.datatype.boolean({ probability: 0.7 }),
    viewCount: faker.number.int({ min: 0, max: 5000 }),
    author: { connect: { id: authorId } },
    ...rest,
  };
}

async function createPost(authorId: number, overrides: PostOverrides = {}) {
  return prisma.post.create({ data: buildPost(authorId, overrides) });
}

async function createPosts(
  authorId: number,
  count: number,
  overrides: PostOverrides = {}
) {
  const posts = [];
  for (let i = 0; i < count; i++) {
    posts.push(await createPost(authorId, overrides));
  }
  return posts;
}

// ─── Comment Factory ─────────────────────────────────────

function buildComment(
  postId: number,
  authorId: number,
  overrides: CommentOverrides = {}
): Prisma.CommentCreateInput {
  const { postId: _, authorId: __, ...rest } = overrides;

  return {
    body: faker.lorem.sentence({ min: 5, max: 20 }),
    post: { connect: { id: postId } },
    author: { connect: { id: authorId } },
    ...rest,
  };
}

async function createComment(
  postId: number,
  authorId: number,
  overrides: CommentOverrides = {}
) {
  return prisma.comment.create({
    data: buildComment(postId, authorId, overrides),
  });
}

// ─── Tag Factory ─────────────────────────────────────────

async function createTag(name?: string) {
  const tagName = name ?? faker.word.noun();
  return prisma.tag.upsert({
    where: { name: tagName },
    update: {},
    create: { name: tagName },
  });
}

async function createTags(names: string[]) {
  return Promise.all(names.map((name) => createTag(name)));
}

// ─── Composite Factories ─────────────────────────────────

/**
 * Create a user with N posts, each with M comments from random users.
 * Useful for generating realistic test datasets.
 */
async function createUserWithContent(options?: {
  userOverrides?: UserOverrides;
  postCount?: number;
  commentsPerPost?: number;
  commenters?: { id: number }[];
}) {
  const {
    userOverrides,
    postCount = 3,
    commentsPerPost = 2,
    commenters = [],
  } = options ?? {};

  const user = await createUser(userOverrides);
  const posts = await createPosts(user.id, postCount);

  for (const post of posts) {
    for (let i = 0; i < commentsPerPost; i++) {
      // Pick a random commenter, or use the post author
      const commenter =
        commenters.length > 0
          ? commenters[faker.number.int({ min: 0, max: commenters.length - 1 })]
          : user;
      await createComment(post.id, commenter.id);
    }
  }

  return { user, posts };
}

// ─── Test Fixture Scenarios ──────────────────────────────

/**
 * Create a minimal fixture for unit tests.
 * Returns deterministic data with known values.
 */
async function createMinimalFixture() {
  const user = await createUser({
    email: "test@example.com",
    name: "Test User",
  });

  const post = await createPost(user.id, {
    title: "Test Post",
    content: "Test content",
    published: true,
    viewCount: 0,
  });

  const comment = await createComment(post.id, user.id, {
    body: "Test comment",
  });

  return { user, post, comment };
}

/**
 * Create a fixture with related data for integration tests.
 */
async function createIntegrationFixture() {
  const [alice, bob, charlie] = await Promise.all([
    createUser({ email: "alice@test.com", name: "Alice" }),
    createUser({ email: "bob@test.com", name: "Bob" }),
    createUser({ email: "charlie@test.com", name: "Charlie", active: false }),
  ]);

  const tags = await createTags(["typescript", "database", "testing"]);

  const alicePosts = await createPosts(alice.id, 3, { published: true });
  const bobPosts = await createPosts(bob.id, 2, { published: true });
  const draftPost = await createPost(alice.id, {
    title: "Draft Post",
    published: false,
  });

  // Cross-user comments
  await createComment(alicePosts[0].id, bob.id);
  await createComment(bobPosts[0].id, alice.id);
  await createComment(alicePosts[1].id, charlie.id);

  return {
    users: { alice, bob, charlie },
    tags,
    posts: {
      alicePosts,
      bobPosts,
      draftPost,
    },
  };
}

// ─── Exports ─────────────────────────────────────────────

export {
  buildUser,
  createUser,
  createUsers,
  buildPost,
  createPost,
  createPosts,
  buildComment,
  createComment,
  createTag,
  createTags,
  createUserWithContent,
  createMinimalFixture,
  createIntegrationFixture,
};
