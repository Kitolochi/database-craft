import { Prisma, PrismaClient } from "@prisma/client";

// Models that support soft delete (must have a deletedAt field)
const SOFT_DELETE_MODELS: Prisma.ModelName[] = ["User", "Post"];

/**
 * Prisma middleware that intercepts delete operations and converts them
 * to soft deletes (setting deletedAt instead of removing the row).
 *
 * Also auto-filters soft-deleted records from all queries unless
 * explicitly requesting them via the `includeDeleted` pattern.
 */
export function applySoftDeleteMiddleware(prisma: PrismaClient) {
  prisma.$use(async (params, next) => {
    if (!params.model || !SOFT_DELETE_MODELS.includes(params.model as Prisma.ModelName)) {
      return next(params);
    }

    // ─── Intercept DELETE → soft delete ────────────────

    if (params.action === "delete") {
      // Convert delete to update with deletedAt
      params.action = "update";
      params.args.data = { deletedAt: new Date() };
      return next(params);
    }

    if (params.action === "deleteMany") {
      // Convert deleteMany to updateMany with deletedAt
      params.action = "updateMany";
      if (params.args.data) {
        params.args.data.deletedAt = new Date();
      } else {
        params.args.data = { deletedAt: new Date() };
      }
      return next(params);
    }

    // ─── Auto-filter deleted records from reads ────────

    if (params.action === "findFirst" || params.action === "findMany") {
      if (!params.args) params.args = {};
      if (params.args.where) {
        // If caller explicitly sets deletedAt, respect it (escape hatch)
        if (params.args.where.deletedAt === undefined) {
          params.args.where.deletedAt = null;
        }
      } else {
        params.args.where = { deletedAt: null };
      }
      return next(params);
    }

    if (params.action === "findUnique" || params.action === "findUniqueOrThrow") {
      // findUnique doesn't support arbitrary where, so we convert to findFirst
      if (!params.args) params.args = {};
      const originalWhere = params.args.where;
      params.action = "findFirst";
      params.args.where = { ...originalWhere, deletedAt: null };
      return next(params);
    }

    if (params.action === "count") {
      if (!params.args) params.args = {};
      if (params.args.where) {
        if (params.args.where.deletedAt === undefined) {
          params.args.where.deletedAt = null;
        }
      } else {
        params.args.where = { deletedAt: null };
      }
      return next(params);
    }

    // ─── Prevent updates on deleted records ────────────

    if (params.action === "update") {
      if (!params.args) params.args = {};
      // Allow updating deletedAt itself (for restore)
      const isRestoring = params.args.data?.deletedAt !== undefined;
      if (!isRestoring) {
        params.action = "updateMany";
        params.args.where = { ...params.args.where, deletedAt: null };
      }
      return next(params);
    }

    if (params.action === "updateMany") {
      if (!params.args) params.args = {};
      if (params.args.where) {
        if (params.args.where.deletedAt === undefined) {
          params.args.where.deletedAt = null;
        }
      } else {
        params.args.where = { deletedAt: null };
      }
      return next(params);
    }

    return next(params);
  });
}

/**
 * Restore a soft-deleted record by clearing its deletedAt field.
 */
export async function restoreRecord<T extends Prisma.ModelName>(
  prisma: PrismaClient,
  model: T,
  id: number
): Promise<void> {
  // Use $executeRawUnsafe to bypass the middleware's auto-filtering
  const tableName = model === "User" ? "users" : "posts";
  await prisma.$executeRawUnsafe(
    `UPDATE ${tableName} SET deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
    id
  );
}

/**
 * Permanently purge records that were soft-deleted before the retention date.
 * Default retention: 30 days.
 */
export async function purgeDeletedRecords(
  prisma: PrismaClient,
  retentionDays: number = 30
): Promise<{ purgedPosts: number; purgedUsers: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  // Purge in dependency order: posts first, then users
  const purgedPosts = await prisma.$executeRaw`
    DELETE FROM posts
    WHERE deleted_at IS NOT NULL
    AND deleted_at < ${cutoffDate}
  `;

  const purgedUsers = await prisma.$executeRaw`
    DELETE FROM users
    WHERE deleted_at IS NOT NULL
    AND deleted_at < ${cutoffDate}
    AND id NOT IN (SELECT DISTINCT author_id FROM posts)
  `;

  return {
    purgedPosts: Number(purgedPosts),
    purgedUsers: Number(purgedUsers),
  };
}

/**
 * Find all soft-deleted records for a model (admin/recovery use).
 */
export async function findDeletedRecords(
  prisma: PrismaClient,
  model: "User" | "Post"
) {
  if (model === "User") {
    // Pass explicit deletedAt filter to bypass auto-null filter
    return prisma.user.findMany({
      where: { deletedAt: { not: null } },
    });
  }
  return prisma.post.findMany({
    where: { deletedAt: { not: null } },
  });
}
