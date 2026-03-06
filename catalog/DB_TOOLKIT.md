# Database Toolkit — Node.js / TypeScript

Master reference for database development. ORMs, databases, managed services, caching, full-text search.

---

## 1. ORMs & Query Builders

### Decision Matrix

| ORM | Best For | TypeScript | Performance | Bundle Size | Learning Curve |
|-----|----------|------------|-------------|-------------|---------------|
| **Prisma** | Rapid dev, large teams | Generated types | Baseline | ~8MB (engine) | Low |
| **Drizzle** | Serverless, edge, SQL devs | Inferred from schema | 3x faster queries | 7.4 KB | Medium |
| **Kysely** | SQL purists, type safety | Inferred from DB | Near-raw SQL | ~50 KB | Medium |
| **Knex** | Legacy, migrations-first | Via @types | Good | ~200 KB | Low |

### When to Use What

| Scenario | Pick |
|----------|------|
| Startup MVP, fastest iteration | **Prisma** |
| Serverless / edge deployment | **Drizzle** |
| Complex SQL, existing schema | **Kysely** |
| Legacy project, migration-heavy | **Knex** |
| Maximum abstraction, large team | **Prisma** |
| Minimal bundle, pay-per-invocation | **Drizzle** |

### Prisma
```bash
npm i prisma @prisma/client
npx prisma init
```
- Best-in-class schema DSL and type generation
- Largest ecosystem: Prisma Studio, Accelerate, Pulse
- Requires `prisma generate` step after schema changes
- Relations, transactions, raw queries all supported
- Best for: rapid development, teams wanting guardrails

### Drizzle
```bash
npm i drizzle-orm
npm i -D drizzle-kit
```
- SQL-like syntax — reads like the SQL it generates
- 3x faster queries than Prisma in benchmarks
- 7.4 KB bundle — ideal for serverless/edge
- No code generation step, schema-in-code
- Supports Postgres, MySQL, SQLite, Turso, Neon, PlanetScale
- Best for: serverless, edge, developers who know SQL

### Kysely
```bash
npm i kysely
npm i pg        # for Postgres
```
- Type-safe SQL query builder — no schema DSL
- Generates exact SQL you expect, no magic
- Composable queries, subqueries, CTEs
- Dialect plugins for Postgres, MySQL, SQLite
- Best for: complex queries, SQL expertise, full control

### Knex
```bash
npm i knex
npm i pg        # for Postgres
```
- Mature query builder + migration system
- 6M+ weekly downloads
- Migration CLI well-established
- No built-in type inference (manual types or codegen)
- Best for: legacy projects, migration tooling

---

## 2. Databases

### Decision Matrix

| Database | Type | Best For | Scaling | Managed Options |
|----------|------|----------|---------|-----------------|
| **PostgreSQL** | Relational | General purpose, complex queries | Vertical + read replicas | Supabase, Neon, RDS |
| **MySQL** | Relational | Web apps, read-heavy | Vertical + Vitess | PlanetScale, RDS |
| **SQLite** | Embedded | Edge, mobile, single-server | Limited (Turso extends) | Turso |
| **MongoDB** | Document | Flexible schemas, prototyping | Horizontal (sharding) | Atlas |
| **Redis** | Key-value/cache | Caching, sessions, queues | Clustering | Upstash, ElastiCache |

### PostgreSQL
```bash
npm i pg @types/pg              # Raw driver
npm i postgres                  # postgres.js (faster)
```
- Gold standard for relational data
- JSON/JSONB, full-text search, extensions (PostGIS, pgvector)
- ACID compliant, battle-tested at scale
- Best for: almost everything — default choice

### MySQL
```bash
npm i mysql2
```
- Read-optimized, simpler replication
- Vitess layer (PlanetScale) for horizontal scaling
- Best for: read-heavy web apps, WordPress ecosystem

### SQLite
```bash
npm i better-sqlite3             # Sync, fastest
npm i @libsql/client             # Turso/libSQL
```
- Zero-config, in-process, file-based
- better-sqlite3: synchronous, fastest local option
- libSQL (Turso fork): adds replication, edge distribution
- Best for: embedded apps, dev/test, edge with Turso

### MongoDB
```bash
npm i mongodb                    # Native driver
npm i mongoose                   # ODM with schemas
```
- Flexible document schemas, nested data
- Good for prototyping when schema is unknown
- Atlas: managed, global clusters, vector search
- Best for: content systems, catalogs, rapid prototyping

### Redis
```bash
npm i ioredis                    # Full-featured client
npm i @upstash/redis             # Serverless (HTTP)
```
- In-memory key-value store, sub-ms reads
- Data structures: strings, hashes, lists, sets, sorted sets, streams
- Pub/sub, Lua scripting, transactions
- Best for: caching, sessions, rate limiting, queues (BullMQ)

---

## 3. Managed Database Services

### Decision Matrix

| Service | Engine | Free Tier | Best For | Pricing Model |
|---------|--------|-----------|----------|---------------|
| **Supabase** | PostgreSQL | 500 MB, 2 projects | Full BaaS (auth + storage + realtime) | Usage-based |
| **Neon** | PostgreSQL | 512 MB, branching | Serverless Postgres, dev workflows | Compute-time |
| **PlanetScale** | MySQL (Vitess) | No free tier | Non-blocking migrations, scale | Storage + reads |
| **Turso** | SQLite (libSQL) | 9 GB, 500 DBs | Edge-distributed, embedded | Reads + storage |
| **Upstash** | Redis + Kafka | 10K cmds/day | Serverless Redis, edge caching | Per-command |

### Supabase
```bash
npm i @supabase/supabase-js
```
- PostgreSQL + Auth + Storage + Realtime + Edge Functions
- PostgREST auto-generates API from schema
- Row-level security (RLS) for multi-tenant
- Real-time subscriptions via WebSockets
- Free: 500 MB database, 1 GB storage, 2 projects
- Best for: full-stack apps wanting Firebase-like DX with Postgres

### Neon
```bash
npm i @neondatabase/serverless
```
- Serverless PostgreSQL — scales to zero
- Database branching (like git branches for your DB)
- Instant provisioning, sub-second cold starts
- Connection pooling built-in
- Free: 512 MB storage, 1 project, branching
- Best for: serverless apps, preview environments, dev workflows

### PlanetScale
```bash
npm i @planetscale/database      # Serverless driver
npm i mysql2                     # Standard driver
```
- MySQL on Vitess — horizontal scaling
- Non-blocking schema changes (deploy requests)
- No foreign key constraints (application-level)
- No free tier (removed 2024)
- Best for: high-scale MySQL, teams wanting safe migrations

### Turso
```bash
npm i @libsql/client
```
- Distributed SQLite via libSQL
- 4x write throughput vs standard SQLite
- Edge-optimized: replicas in 30+ regions
- Embedded replicas: local read, remote write
- Free: 9 GB total storage, 500 databases
- Best for: edge apps, read-heavy with local replicas

### Upstash
```bash
npm i @upstash/redis              # Redis
npm i @upstash/ratelimit          # Rate limiting
npm i @upstash/qstash             # Message queue
```
- Serverless Redis — pay per command
- REST API (works in edge/serverless without TCP)
- Built-in rate limiting, message queues (QStash)
- Free: 10K commands/day, 256 MB
- Best for: serverless caching, rate limiting, edge

---

## 4. Caching Patterns

### Strategy Comparison

| Pattern | Consistency | Performance | Complexity | Best For |
|---------|-------------|-------------|------------|----------|
| **Cache-Aside** | Eventual | Good | Low | General caching (default) |
| **Write-Through** | Strong | Medium | Medium | Consistency-critical data |
| **Write-Behind** | Eventual | Best | High | Write-heavy, batch DB writes |
| **Read-Through** | Eventual | Good | Medium | Uniform cache access |

### Cache-Aside (Lazy Loading) — Default Choice
```typescript
import Redis from 'ioredis';
const redis = new Redis();

async function getUser(id: string) {
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.user.findUnique({ where: { id } });
  if (user) {
    await redis.setex(`user:${id}`, 3600, JSON.stringify(user));
  }
  return user;
}

// Invalidate on write
async function updateUser(id: string, data: UpdateData) {
  const user = await db.user.update({ where: { id }, data });
  await redis.del(`user:${id}`);
  return user;
}
```
- App manages cache reads and writes
- Cache miss: fetch from DB, populate cache
- Write: update DB, invalidate cache
- Risk: stale data between write and next read

### Write-Through
```typescript
async function updateUser(id: string, data: UpdateData) {
  const user = await db.user.update({ where: { id }, data });
  await redis.setex(`user:${id}`, 3600, JSON.stringify(user));
  return user;
}
```
- Every write updates both DB and cache
- Cache always reflects latest DB state
- Higher write latency (two writes per operation)
- Best for: data where reads must be fresh

### Write-Behind (Write-Back)
```typescript
async function updateUser(id: string, data: UpdateData) {
  // Write to cache immediately
  await redis.setex(`user:${id}`, 3600, JSON.stringify(data));
  // Queue DB write for later
  await queue.add('db-write', { table: 'users', id, data });
  return data;
}
```
- Write to cache first, async write to DB
- Fastest writes — DB batched in background
- Risk: data loss if cache fails before DB write
- Best for: write-heavy workloads (analytics, counters)

### Cache Invalidation Patterns
```typescript
// Pattern 1: TTL-based (simplest)
await redis.setex(key, 300, value);  // 5 min expiry

// Pattern 2: Event-driven invalidation
async function onUserUpdated(userId: string) {
  await redis.del(`user:${userId}`);
  await redis.del(`user-list:page:*`);  // clear list caches
}

// Pattern 3: Tag-based invalidation
async function invalidateByTag(tag: string) {
  const keys = await redis.smembers(`tag:${tag}`);
  if (keys.length) await redis.del(...keys);
  await redis.del(`tag:${tag}`);
}
```

---

## 5. Full-Text Search

### Decision Matrix

| Solution | Latency | Typo Tolerance | Hosting | Best For | Pricing |
|----------|---------|----------------|---------|----------|---------|
| **Postgres tsvector** | ~10-50ms | No | Included with Postgres | Simple search, no extra infra | Free |
| **Meilisearch** | <50ms | Yes (built-in) | Self-hosted or Cloud | Best DX, fast integration | Free / Cloud plans |
| **Typesense** | <5ms | Yes | Self-hosted or Cloud | Vector search, speed | Free / Cloud plans |
| **Algolia** | <20ms | Yes | Managed only | Enterprise, analytics | Per-search pricing |

### Postgres Full-Text Search (tsvector)
```sql
-- Add tsvector column
ALTER TABLE articles ADD COLUMN search_vector tsvector;
UPDATE articles SET search_vector =
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''));

-- Create GIN index
CREATE INDEX idx_articles_search ON articles USING GIN(search_vector);

-- Query
SELECT * FROM articles
WHERE search_vector @@ plainto_tsquery('english', 'database optimization');
```
- Zero additional infrastructure
- Ranking with ts_rank, phrase matching, language support
- No typo tolerance, no faceting
- Best for: simple search needs within Postgres

### Meilisearch
```bash
# Docker
docker run -p 7700:7700 getmeili/meilisearch

# Node client
npm i meilisearch
```
```typescript
import { MeiliSearch } from 'meilisearch';
const client = new MeiliSearch({ host: 'http://localhost:7700' });

// Index documents
await client.index('products').addDocuments(products);

// Search with typo tolerance
const results = await client.index('products').search('iphne', {
  limit: 10,
  attributesToHighlight: ['name'],
  filter: ['price < 1000'],
});
```
- Sub-50ms search, built-in typo tolerance
- Faceted search, filtering, sorting
- Best developer experience for search
- Best for: product search, content search, autocomplete

### Typesense
```bash
npm i typesense
```
- Sub-5ms latency, tuned for speed
- Vector search support (hybrid text + semantic)
- Geo search, faceting, curation rules
- Fair, transparent pricing
- Best for: high-performance search, vector/semantic search

### Algolia
```bash
npm i algoliasearch
```
- Enterprise-grade managed search
- Analytics, A/B testing, personalization
- Most expensive option
- Best for: enterprise apps with search analytics needs

---

## Quick Install Reference

```bash
# ORMs & Query Builders
npm i prisma @prisma/client        # Type-safe ORM (generate step)
npm i drizzle-orm                  # SQL-like, serverless-optimized
npm i -D drizzle-kit               # Drizzle migrations CLI
npm i kysely                       # Type-safe query builder
npm i knex                         # Classic query builder

# Database Drivers
npm i pg @types/pg                 # PostgreSQL (node-postgres)
npm i postgres                     # PostgreSQL (postgres.js, faster)
npm i mysql2                       # MySQL
npm i better-sqlite3               # SQLite (sync, fast)
npm i mongodb                      # MongoDB native
npm i mongoose                     # MongoDB ODM
npm i ioredis                      # Redis (full-featured)

# Managed Service Clients
npm i @supabase/supabase-js        # Supabase
npm i @neondatabase/serverless     # Neon serverless Postgres
npm i @planetscale/database        # PlanetScale serverless MySQL
npm i @libsql/client               # Turso / libSQL
npm i @upstash/redis               # Upstash serverless Redis
npm i @upstash/ratelimit           # Upstash rate limiting
npm i @upstash/qstash              # Upstash message queue

# Search
npm i meilisearch                  # Meilisearch client
npm i typesense                    # Typesense client
npm i algoliasearch                # Algolia client

# Connection Pooling
npm i pg-pool                      # Node-level pooling
# PgBouncer: external process      # 72% transaction time reduction
```

---

## Recommended Stacks by Use Case

**Startup / MVP:**
Prisma + Supabase (Postgres + Auth + Storage) + Upstash Redis

**Serverless / Edge:**
Drizzle + Neon or Turso + Upstash Redis

**High-Scale Web App:**
Drizzle or Kysely + self-hosted Postgres + PgBouncer + Redis + Meilisearch

**Enterprise API:**
Prisma + RDS Postgres + ElastiCache Redis + Algolia or Typesense

**Content Platform:**
Prisma + Supabase + Meilisearch + Upstash Redis

**Edge-First (Global):**
Drizzle + Turso (embedded replicas) + Upstash Redis

---

## Sources

- [Prisma](https://prisma.io/) | [Drizzle](https://orm.drizzle.team/) | [Kysely](https://kysely.dev/) | [Knex](https://knexjs.org/)
- [Supabase](https://supabase.com/) | [Neon](https://neon.tech/) | [PlanetScale](https://planetscale.com/) | [Turso](https://turso.tech/)
- [Upstash](https://upstash.com/) | [Redis](https://redis.io/)
- [Meilisearch](https://meilisearch.com/) | [Typesense](https://typesense.org/) | [Algolia](https://algolia.com/)
- [PostgreSQL Full-Text Search Docs](https://www.postgresql.org/docs/current/textsearch.html)
