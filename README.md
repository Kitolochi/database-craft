# Database Craft

A collection of database patterns, ORM recipes, caching strategies, and search integrations for Node.js + TypeScript. Self-contained, copy-paste ready examples.

## Structure

```
catalog/            Reference docs and pattern checklists
examples/
  orm/              Prisma, Drizzle, Kysely CRUD and relations
  schema/           Normalization, soft deletes, multi-tenancy, audit
  migrations/       Zero-downtime, seeds, backfills
  queries/          Indexing, N+1, EXPLAIN, pagination, pooling
  caching/          Redis cache-aside, write-through, invalidation
  search/           Postgres FTS, Meilisearch, Typesense
  managed/          Supabase, Neon, Turso, Upstash recipes
```

## Catalog

- **DB_TOOLKIT.md** -- ORMs, databases, managed services, caching, search with decision matrices
- **PATTERN_CATALOG.md** -- 60+ database patterns organized by category with build status

## Tech

- Node.js + TypeScript
- Prisma / Drizzle / Kysely ORMs
- PostgreSQL / SQLite / Redis
- Supabase / Neon / Turso / Upstash managed services
- Meilisearch / Typesense search engines
- Working examples with inline comments
- Each example is self-contained with its own package.json
