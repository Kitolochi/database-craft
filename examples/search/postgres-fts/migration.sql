-- ═══════════════════════════════════════════════════════════
-- Postgres Full-Text Search Setup
--
-- Run: psql $DATABASE_URL -f migration.sql
-- ═══════════════════════════════════════════════════════════

-- Create the articles table with a dedicated tsvector column
CREATE TABLE IF NOT EXISTS articles (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(500) NOT NULL,
  body        TEXT NOT NULL,
  author      VARCHAR(255) NOT NULL,
  category    VARCHAR(100),
  published   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  -- Dedicated tsvector column for fast full-text search.
  -- Storing the tsvector avoids recomputing it on every query.
  -- Weighted: title (A) is ranked higher than body (B).
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED
);

-- GIN index on the tsvector column — required for fast FTS queries.
-- Without this index, Postgres does a sequential scan on every search.
CREATE INDEX IF NOT EXISTS idx_articles_search
  ON articles USING GIN (search_vector);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles (category);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles (author);

-- ─── Seed Data ───────────────────────────────────────────

INSERT INTO articles (title, body, author, category, published) VALUES
  (
    'Getting Started with PostgreSQL Full-Text Search',
    'PostgreSQL provides powerful built-in full-text search capabilities. Unlike simple LIKE queries, full-text search understands language, handles stemming, and supports ranking. This guide covers tsvector columns, GIN indexes, and query functions.',
    'Alice Johnson',
    'database',
    true
  ),
  (
    'Understanding Database Indexes',
    'Indexes are data structures that speed up data retrieval. B-tree indexes work well for equality and range queries. GIN indexes excel at full-text search and array containment. GiST indexes handle geometric and range types. Choosing the right index type is critical for query performance.',
    'Bob Smith',
    'database',
    true
  ),
  (
    'Building REST APIs with Node.js',
    'Node.js combined with Express provides a lightweight framework for building REST APIs. This tutorial covers routing, middleware, error handling, and database integration with PostgreSQL. We use parameterized queries to prevent SQL injection.',
    'Alice Johnson',
    'backend',
    true
  ),
  (
    'TypeScript Best Practices for 2024',
    'TypeScript has become the standard for large JavaScript projects. Key practices include strict mode, discriminated unions, template literal types, and satisfies operator. These patterns catch bugs at compile time rather than runtime.',
    'Charlie Lee',
    'typescript',
    true
  ),
  (
    'Optimizing PostgreSQL Query Performance',
    'Query optimization starts with EXPLAIN ANALYZE. Look for sequential scans on large tables, nested loop joins with high row counts, and sorts that spill to disk. Adding proper indexes and rewriting queries can yield 100x performance improvements.',
    'Bob Smith',
    'database',
    true
  ),
  (
    'Draft: Advanced Search Patterns',
    'This article explores faceted search, fuzzy matching with pg_trgm, and combining full-text search with structured filters. Work in progress.',
    'Alice Johnson',
    'database',
    false
  );
