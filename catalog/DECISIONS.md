# Database Decision Frameworks

Opinionated guides for common database choices. Each section gives a default, explains when to deviate, and provides a comparison table.

---

## ORM: Drizzle vs Prisma

**Default choice:** Drizzle — SQL-like API, zero runtime overhead, full type safety from schema.

**Choose Drizzle when:** You know SQL and want an ORM that stays close to it, need the best performance (queries compile to SQL at build time), or want schema-as-code that mirrors your database.

**Choose Prisma when:** You want the most mature ecosystem (migrations, studio, pulse, accelerate), prefer schema-first with a DSL, or your team finds the Prisma Client API more intuitive.

| Factor | Drizzle | Prisma |
|--------|---------|--------|
| API style | SQL-like (select().from().where()) | Active Record-like (model.findMany()) |
| Schema definition | TypeScript | Prisma Schema Language (.prisma) |
| Type safety | From schema (zero codegen at runtime) | From generated client (codegen step) |
| Raw SQL | First-class (sql\`\`) | Supported (prisma.$queryRaw) |
| Performance | ~2x faster queries | Good (Rust query engine) |
| Bundle size | ~50KB | ~8MB (query engine binary) |
| Edge/serverless | Yes (lightweight) | Prisma Accelerate needed |
| Migration tool | Drizzle Kit | Prisma Migrate |
| GUI | Drizzle Studio | Prisma Studio |
| Joins | Native SQL joins | Include/select (nested) |
| Learning curve | Medium (SQL knowledge helps) | Low (intuitive API) |
| Maturity | Newer (2023) | Established (2019) |

**Our pick:** Drizzle for new TypeScript projects. Prisma if your team prefers its DX or you need its ecosystem (Pulse, Accelerate).

---

## Serverless Database: Neon vs Turso vs Supabase vs D1

**Default choice:** Neon — serverless Postgres with zero cold starts, branching, and autoscaling.

**Choose Neon when:** You want Postgres without managing infrastructure, need database branching for preview environments, or want generous free tier with autoscaling.

**Choose Turso when:** You want embedded SQLite with edge replication (libSQL), need multi-region reads, or your app is read-heavy with edge deployment.

**Choose Supabase when:** You need Postgres + auth + storage + realtime as a unified platform, want PostgREST auto-generated APIs, or need row-level security.

**Choose D1 when:** You're already on Cloudflare Workers, want SQLite at the edge with zero latency, or need the simplest possible setup.

| Factor | Neon | Turso | Supabase | D1 |
|--------|------|-------|----------|-----|
| Database engine | PostgreSQL | libSQL (SQLite fork) | PostgreSQL | SQLite |
| Serverless | Yes | Yes | Semi (always-on) | Yes |
| Edge replicas | No | Yes (global) | No | Yes (Cloudflare) |
| Branching | Yes (instant) | No | No | No |
| Free tier | Generous (0.5GB) | 500 DBs, 9GB | 500MB, 2 projects | 5GB |
| Connection | HTTP + WebSocket | HTTP + WebSocket | HTTP (PostgREST) | Workers binding |
| ORM support | All (it's Postgres) | Drizzle, Prisma | All (it's Postgres) | Drizzle |
| Auto-scaling | Scale-to-zero | Always available | Always on | Per-request |
| Use case | General purpose | Edge-first reads | Full-stack platform | Cloudflare apps |

**Our pick:** Neon for general-purpose serverless Postgres. Turso for edge-first apps with global reads. Supabase for full-stack platforms.

---

## Scaling: Pooling -> Replicas -> Sharding

**Default path (graduate when you hit limits):**

**Connection Pooling** (first bottleneck: connection count):
- Use PgBouncer or Neon's built-in pooler
- Handles 1K-10K concurrent connections with a few dozen actual PG connections
- Try this first — most "scaling" problems are actually connection problems

**Read Replicas** (second bottleneck: read throughput):
- Route reads to replicas, writes to primary
- Works when read/write ratio is > 80/20
- Typical setup: 1 primary + 2-3 read replicas
- Watch for replication lag on time-sensitive reads

**Partitioning** (third bottleneck: table size):
- Range partitioning (by date) for time-series data
- List partitioning (by tenant_id) for multi-tenant
- Keeps indexes manageable, enables partition pruning

**Sharding** (last resort: write throughput):
- Application-level sharding by tenant/region
- Citus for transparent PostgreSQL sharding
- Vitess for MySQL sharding
- Don't do this unless you genuinely need it

| Stage | When | Complexity | Handles |
|-------|------|------------|---------|
| Pooling | > 100 connections | Low | 10K connections |
| Replicas | > 10K reads/sec | Medium | 100K reads/sec |
| Partitioning | > 100M rows/table | Medium | Billions of rows |
| Sharding | > 50K writes/sec | Very High | Horizontal scale |

**Our pick:** 90% of apps never need more than connection pooling + a read replica. Don't shard until you've exhausted every other option.

---

## Primary Keys: UUIDv7 vs UUIDv4 vs CUID2

**Default choice:** UUIDv7 — time-sortable, B-tree friendly, drop-in replacement for UUIDv4.

**Choose UUIDv7 when:** You need a universally unique ID that sorts chronologically, want good B-tree index performance, or are replacing UUIDv4 (same format, same columns).

**Choose UUIDv4 when:** You need maximum unpredictability (no timestamp leakage), have existing UUIDv4 infrastructure, or are using a library/DB that generates them automatically.

**Choose CUID2 when:** You need URL-safe IDs without hyphens, want collision resistance without UUID format, or need shorter IDs for user-facing URLs.

| Factor | UUIDv7 | UUIDv4 | CUID2 |
|--------|--------|--------|-------|
| Format | 8-4-4-4-12 (36 chars) | 8-4-4-4-12 (36 chars) | 24 chars (URL-safe) |
| Sortable | Yes (time-ordered) | No (random) | No |
| Timestamp | Extractable (48-bit) | None | None |
| B-tree performance | Excellent (sequential) | Poor (random splits) | Poor (random) |
| Unpredictability | Partially (random suffix) | Fully random | Fully random |
| Standard | RFC 9562 | RFC 9562 | Community |
| DB native | Postgres 17+ (gen_random_uuid v7) | All databases | Application-only |
| Collision risk | Negligible | Negligible | Negligible |

**Our pick:** UUIDv7 for primary keys. CUID2 for user-facing IDs in URLs.

---

## Migration Tools: Drizzle Kit vs Prisma Migrate vs Atlas

**Default choice:** Use whatever your ORM provides (Drizzle Kit or Prisma Migrate).

**Choose Drizzle Kit when:** You use Drizzle ORM. Schema changes in TypeScript, generates SQL migrations automatically, supports custom migration SQL.

**Choose Prisma Migrate when:** You use Prisma. Schema changes in .prisma files, shadow database for drift detection, built-in migration history.

**Choose Atlas when:** You need ORM-agnostic migrations, want declarative schema management (desired-state migrations), or manage multiple database types from one tool.

| Factor | Drizzle Kit | Prisma Migrate | Atlas |
|--------|------------|----------------|-------|
| Schema format | TypeScript | Prisma SDL | HCL or SQL |
| Migration type | SQL files | SQL files | Declarative or versioned |
| Drift detection | Manual | Shadow database | Automatic |
| Multi-database | Postgres, MySQL, SQLite | Same | Postgres, MySQL, SQLite, more |
| ORM coupling | Drizzle only | Prisma only | Any or none |
| Custom SQL | Full control | Escape hatch | Full control |
| Zero-downtime | Manual planning | Manual planning | Built-in analysis |
| CI integration | CLI | CLI | CLI + GitHub Action |

**Our pick:** Use your ORM's migration tool for simplicity. Evaluate Atlas for complex multi-database or ORM-free setups.
