# Database Pattern Catalog

Master reference of database patterns and working examples to build.
Each entry: description, difficulty, dependencies, and use case.

Status: [x] = built, [ ] = available to build

---

## Category 1: ORM Patterns

- [ ] **Prisma CRUD** — Model definition, create/read/update/delete, relations, transactions. Prisma + Postgres.
- [ ] **Prisma Relations** — One-to-many, many-to-many, self-referential. Eager loading with `include`.
- [ ] **Prisma Raw Queries** — `$queryRaw` and `$executeRaw` for complex SQL. Tagged template safety.
- [ ] **Drizzle CRUD** — Schema-in-code, SQL-like queries, insert/select/update/delete. Drizzle + Postgres.
- [ ] **Drizzle Relations** — Relational queries API, nested selects, joins.
- [ ] **Drizzle + Turso** — Drizzle with libSQL driver for edge-distributed SQLite.
- [ ] **Kysely Queries** — Type-safe query builder with raw SQL feel. Select, join, subquery, CTE.
- [ ] **Kysely + Postgres** — Full CRUD with pg dialect, transactions, connection pool.
- [ ] **Knex Migrations** — Migration CLI, up/down, seed files, rollback strategies.
- [ ] **ORM Comparison** — Same schema + queries in Prisma, Drizzle, Kysely side-by-side.

## Category 2: Schema Design

- [ ] **Normalization** — 1NF through 3NF with practical examples. When to denormalize.
- [ ] **Soft Deletes** — `deletedAt` timestamp pattern. Query scoping, restoration, permanent purge.
- [ ] **Audit Trail** — `createdAt`, `updatedAt`, `createdBy` fields. History table pattern for full change log.
- [ ] **Multi-Tenancy (Row-Level)** — Tenant ID column, row-level security (RLS), query scoping middleware.
- [ ] **Multi-Tenancy (Schema-Level)** — Separate schemas per tenant. Postgres `search_path` switching.
- [ ] **Multi-Tenancy (Database-Level)** — Separate database per tenant. Connection routing.
- [ ] **Polymorphic Associations** — Single-table inheritance, discriminator column, union types.
- [ ] **JSON Columns** — When to use JSONB vs normalized tables. Indexing JSON with GIN.
- [ ] **Enum Patterns** — Postgres ENUMs vs lookup tables. Migration strategies for adding values.
- [ ] **UUID vs Serial** — UUID v7 (time-ordered) vs auto-increment. Index performance implications.
- [ ] **Slugs & Natural Keys** — URL-friendly identifiers, uniqueness, collision handling.

## Category 3: Migrations

- [ ] **Forward-Only Migrations** — No down migrations. Additive-only schema changes.
- [ ] **Zero-Downtime Migrations** — Column add → backfill → code deploy → drop old column. No locks.
- [ ] **Prisma Migrations** — `prisma migrate dev`, `prisma migrate deploy`, drift detection.
- [ ] **Drizzle Migrations** — `drizzle-kit generate`, `drizzle-kit push`, custom migration scripts.
- [ ] **Seed Data** — Development seeds, test fixtures, idempotent production seeds.
- [ ] **Data Backfill** — Batch processing for large table updates. Progress tracking, resumability.
- [ ] **Schema Versioning** — Tracking schema version in app. Compatibility checks at startup.

## Category 4: Query Optimization

- [ ] **Indexing Strategies** — B-tree, GIN, GiST, partial, composite. When each type applies.
- [ ] **N+1 Prevention** — DataLoader pattern, eager loading, ORM `include`/`with`. Before/after comparison.
- [ ] **Connection Pooling** — PgBouncer setup (72% transaction time reduction). Node `pg.Pool` config.
- [ ] **EXPLAIN Analysis** — Reading `EXPLAIN ANALYZE` output. Identifying seq scans, hash joins, sort costs.
- [ ] **Pagination** — Offset vs cursor-based. Keyset pagination for large datasets. Prisma/Drizzle examples.
- [ ] **Batch Operations** — Bulk insert, upsert, `createMany`. Transaction batching for consistency.
- [ ] **Query Profiling** — Prisma query logging, Drizzle logger, `pg` query events. Slow query detection.
- [ ] **Materialized Views** — Precomputed query results. Refresh strategies (manual, on-demand, scheduled).
- [ ] **Read Replicas** — Routing reads to replicas. Prisma `$extends` for read/write splitting.

## Category 5: Caching

- [ ] **Redis Cache-Aside** — Lazy loading pattern with TTL. Invalidation on write. ioredis + Prisma.
- [ ] **Write-Through Cache** — Synchronous cache update on every write. Strong consistency.
- [ ] **Cache Invalidation** — TTL, event-driven, tag-based strategies. Pattern selection guide.
- [ ] **Session Store** — Redis-backed sessions with express-session. TTL, sliding expiration.
- [ ] **Rate Limiting** — Upstash `@upstash/ratelimit` or Redis INCR + EXPIRE. Sliding window.
- [ ] **Distributed Lock** — Redis SET NX EX for mutex across instances. Redlock algorithm.
- [ ] **Cache Warming** — Pre-populate cache on deploy. Background refresh for hot data.
- [ ] **Serverless Caching** — Upstash Redis via HTTP. Edge-compatible, no TCP connections.

## Category 6: Search

- [ ] **Postgres FTS Setup** — tsvector column, GIN index, `to_tsvector`/`plainto_tsquery`. Ranking.
- [ ] **Postgres FTS Advanced** — Weighted search (title > body), phrase matching, language config.
- [ ] **Meilisearch Integration** — Index sync from Postgres, search API, facets, filters, typo tolerance.
- [ ] **Typesense Integration** — Schema definition, indexing, search with vector support.
- [ ] **Search Sync Pipeline** — DB trigger or change stream to keep search index in sync. Debouncing.
- [ ] **Autocomplete** — Prefix search with Meilisearch or Postgres trigram (`pg_trgm`).

## Category 7: Managed Service Patterns

- [ ] **Supabase Setup** — Project init, client config, RLS policies, real-time subscriptions.
- [ ] **Supabase + Prisma** — Using Prisma with Supabase Postgres. Connection string, pooling.
- [ ] **Neon Branching** — Database branches for preview deployments. Branch per PR workflow.
- [ ] **Neon Serverless** — `@neondatabase/serverless` driver with Drizzle. Cold start optimization.
- [ ] **Turso Embedded Replicas** — Local read replica in the app process, remote writes.
- [ ] **Upstash Redis Patterns** — Rate limiting, caching, pub/sub via HTTP. Edge-compatible.

---

## Quick Reference: Pattern -> Use Case

| Pattern | Best For |
|---------|----------|
| Prisma CRUD | Rapid development, type-safe DB access |
| Drizzle CRUD | Serverless, edge, SQL-oriented devs |
| Kysely Queries | Complex SQL, full control, no schema DSL |
| Soft Deletes | Data recovery, compliance, audit requirements |
| Multi-Tenancy (Row) | SaaS with shared database |
| N+1 Prevention | API performance, reducing DB round trips |
| Connection Pooling | High-concurrency apps, serverless |
| Redis Cache-Aside | General caching, session storage |
| Meilisearch | Product/content search, autocomplete |
| Postgres FTS | Simple search without extra infrastructure |
| Neon Branching | Preview environments, CI/CD |
| Turso Replicas | Edge-first, globally distributed reads |

---

## Build Priority

**Tier 1 -- Essentials (build first):**
1. Prisma CRUD
2. Drizzle CRUD
3. Soft Deletes
4. N+1 Prevention
5. Redis Cache-Aside
6. Connection Pooling
7. Postgres FTS Setup
8. Seed Data

**Tier 2 -- Modern Patterns:**
9. Kysely Queries
10. Drizzle + Turso
11. Zero-Downtime Migrations
12. Indexing Strategies
13. Meilisearch Integration
14. Supabase Setup
15. Neon Branching
16. Cache Invalidation

**Tier 3 -- Advanced:**
17. Multi-Tenancy (Row-Level)
18. Audit Trail
19. EXPLAIN Analysis
20. Materialized Views
21. Read Replicas
22. Distributed Lock
23. Search Sync Pipeline
24. Turso Embedded Replicas
