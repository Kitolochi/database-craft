import {
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Table Definitions ──────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    bio: text("bio"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  })
);

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull(),
    published: boolean("published").default(false).notNull(),
    viewCount: integer("view_count").default(0).notNull(),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    authorIdx: index("posts_author_idx").on(table.authorId),
    publishedIdx: index("posts_published_idx").on(
      table.published,
      table.createdAt
    ),
  })
);

export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    body: text("body").notNull(),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    postIdx: index("comments_post_idx").on(table.postId),
    authorIdx: index("comments_author_idx").on(table.authorId),
  })
);

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});

export const tagsOnPosts = pgTable(
  "tags_on_posts",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: index("tags_on_posts_pk").on(table.postId, table.tagId),
  })
);

// ─── Relations (for relational query API) ────────────────

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
  comments: many(comments),
  tags: many(tagsOnPosts),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, {
    fields: [comments.postId],
    references: [posts.id],
  }),
  author: one(users, {
    fields: [comments.authorId],
    references: [users.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  posts: many(tagsOnPosts),
}));

export const tagsOnPostsRelations = relations(tagsOnPosts, ({ one }) => ({
  post: one(posts, {
    fields: [tagsOnPosts.postId],
    references: [posts.id],
  }),
  tag: one(tags, {
    fields: [tagsOnPosts.tagId],
    references: [tags.id],
  }),
}));

// ─── Type Exports ────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
