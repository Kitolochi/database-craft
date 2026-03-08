/**
 * POSTGRES INDEXING STRATEGIES
 *
 * Indexes are the single most impactful optimization for query performance.
 * Choosing the wrong index type (or missing one entirely) can turn a 1ms
 * query into a 10-second table scan.
 *
 * This example covers:
 *   1. B-tree — default, works for equality and range queries
 *   2. Composite — multi-column indexes for compound WHERE clauses
 *   3. Partial — index a subset of rows (e.g., only active records)
 *   4. GIN — inverted index for arrays, JSONB, full-text search
 *   5. GiST — generalized search tree for geometric/range data
 *
 * Each section includes the CREATE INDEX SQL, EXPLAIN ANALYZE showing
 * the before/after, and guidance on when to use it.
 *
 * No database connection needed — this file documents the SQL and
 * provides helper functions that generate index DDL statements.
 */

// ─── Index Type Definitions ──────────────────────────────

type IndexType = "btree" | "hash" | "gin" | "gist" | "brin";

interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  type: IndexType;
  unique: boolean;
  where?: string;       // Partial index condition
  using?: string;       // Expression (e.g., GIN on jsonb column)
  concurrently: boolean;
}

// ─── Helper: Generate CREATE INDEX SQL ───────────────────

function createIndexSQL(def: IndexDefinition): string {
  const unique = def.unique ? "UNIQUE " : "";
  const concurrently = def.concurrently ? "CONCURRENTLY " : "";
  const using = def.type !== "btree" ? ` USING ${def.type}` : "";
  const columns = def.using ?? def.columns.join(", ");
  const where = def.where ? `\n  WHERE ${def.where}` : "";

  return `CREATE ${unique}INDEX ${concurrently}${def.name}\n  ON ${def.table}${using} (${columns})${where};`;
}

function dropIndexSQL(name: string, concurrently: boolean = true): string {
  const conc = concurrently ? "CONCURRENTLY " : "";
  return `DROP INDEX ${conc}IF EXISTS ${name};`;
}

// ─── 1. B-tree Index (Default) ───────────────────────────
//
// B-tree is the default index type. It stores values in a sorted tree
// structure, enabling fast lookups for:
//   - Equality:       WHERE email = 'alice@example.com'
//   - Range:          WHERE created_at > '2024-01-01'
//   - Sorting:        ORDER BY created_at DESC
//   - Prefix LIKE:    WHERE name LIKE 'Ali%'  (not '%ali%')
//
// EXPLAIN ANALYZE before index:
//   Seq Scan on users  (cost=0.00..25000.00 rows=1 width=64)
//     Filter: (email = 'alice@example.com'::text)
//     Rows Removed by Filter: 999999
//   Planning Time: 0.1ms   Execution Time: 152.3ms
//
// EXPLAIN ANALYZE after index:
//   Index Scan using idx_users_email on users  (cost=0.42..8.44 rows=1 width=64)
//     Index Cond: (email = 'alice@example.com'::text)
//   Planning Time: 0.1ms   Execution Time: 0.03ms

const btreeExamples: IndexDefinition[] = [
  {
    name: "idx_users_email",
    table: "users",
    columns: ["email"],
    type: "btree",
    unique: true,
    concurrently: true,
  },
  {
    name: "idx_posts_created_at",
    table: "posts",
    columns: ["created_at"],
    type: "btree",
    unique: false,
    concurrently: true,
  },
];

// ─── 2. Composite Index ──────────────────────────────────
//
// A composite index covers multiple columns. Column ORDER matters:
// the index is usable for queries that filter on a leading prefix
// of the indexed columns (leftmost prefix rule).
//
//   Index on (tenant_id, created_at, status):
//     WHERE tenant_id = 1                       -- uses index
//     WHERE tenant_id = 1 AND created_at > ...  -- uses index
//     WHERE tenant_id = 1 AND status = 'active' -- uses index (skip scan)
//     WHERE status = 'active'                   -- DOES NOT use index
//     WHERE created_at > '2024-01-01'           -- DOES NOT use index
//
// Rule of thumb: put equality columns first, then range columns.
//
// EXPLAIN ANALYZE before:
//   Seq Scan on orders  (cost=0.00..50000.00 rows=500 width=128)
//     Filter: ((tenant_id = 42) AND (created_at > '2024-06-01'))
//     Rows Removed by Filter: 999500
//   Execution Time: 245.8ms
//
// EXPLAIN ANALYZE after:
//   Index Scan using idx_orders_tenant_date on orders  (cost=0.43..52.10 rows=500 width=128)
//     Index Cond: ((tenant_id = 42) AND (created_at > '2024-06-01'))
//   Execution Time: 0.8ms

const compositeExamples: IndexDefinition[] = [
  {
    name: "idx_orders_tenant_date",
    table: "orders",
    columns: ["tenant_id", "created_at"],
    type: "btree",
    unique: false,
    concurrently: true,
  },
  {
    name: "idx_posts_author_published",
    table: "posts",
    columns: ["author_id", "published", "created_at"],
    type: "btree",
    unique: false,
    concurrently: true,
  },
];

// ─── 3. Partial Index ────────────────────────────────────
//
// A partial index only includes rows matching a WHERE condition.
// Smaller index = faster lookups + less storage + cheaper writes.
//
// Use cases:
//   - Index only active/non-deleted records (skip 90% of rows)
//   - Index only unprocessed jobs in a queue table
//   - Unique constraint only where a flag is true
//
// EXPLAIN ANALYZE before (full B-tree on status):
//   Index Scan using idx_orders_status on orders  (cost=0.43..8500.00 rows=200 width=128)
//     Index Cond: (status = 'pending')
//   -- Index is 50MB (all 1M rows)
//
// EXPLAIN ANALYZE after (partial index):
//   Index Scan using idx_orders_pending on orders  (cost=0.29..85.00 rows=200 width=128)
//     Index Cond: (status = 'pending')
//   -- Index is 500KB (only pending rows, ~1% of data)

const partialExamples: IndexDefinition[] = [
  {
    name: "idx_orders_pending",
    table: "orders",
    columns: ["created_at"],
    type: "btree",
    unique: false,
    where: "status = 'pending'",
    concurrently: true,
  },
  {
    name: "idx_users_active_email",
    table: "users",
    columns: ["email"],
    type: "btree",
    unique: true,
    where: "deleted_at IS NULL",
    concurrently: true,
  },
];

// ─── 4. GIN Index (Generalized Inverted Index) ──────────
//
// GIN indexes are designed for values that contain multiple elements:
//   - JSONB columns (contains @>, exists ?, path operators)
//   - Array columns (contains @>, overlap &&)
//   - Full-text search (tsvector @@ tsquery)
//   - Trigram similarity (pg_trgm for LIKE '%pattern%')
//
// GIN is slower to update than B-tree (each insert may touch many
// index entries) but much faster for containment queries.
//
// EXPLAIN ANALYZE before (JSONB query without index):
//   Seq Scan on products  (cost=0.00..35000.00 rows=50 width=256)
//     Filter: (metadata @> '{"color": "red"}'::jsonb)
//     Rows Removed by Filter: 999950
//   Execution Time: 890.2ms
//
// EXPLAIN ANALYZE after (GIN on metadata):
//   Bitmap Heap Scan on products  (cost=24.50..1200.00 rows=50 width=256)
//     Recheck Cond: (metadata @> '{"color": "red"}'::jsonb)
//     ->  Bitmap Index Scan on idx_products_metadata  (cost=0.00..24.49 rows=50)
//   Execution Time: 1.2ms

const ginExamples: IndexDefinition[] = [
  {
    name: "idx_products_metadata",
    table: "products",
    columns: ["metadata"],
    type: "gin",
    unique: false,
    concurrently: true,
  },
  {
    name: "idx_posts_tags",
    table: "posts",
    columns: ["tags"],
    type: "gin",
    unique: false,
    concurrently: true,
  },
  {
    name: "idx_articles_search",
    table: "articles",
    columns: ["search_vector"],
    type: "gin",
    unique: false,
    concurrently: true,
  },
];

// ─── 5. GiST Index (Generalized Search Tree) ────────────
//
// GiST indexes support geometric and range data types:
//   - PostGIS geometry (ST_Contains, ST_DWithin, ST_Intersects)
//   - Range types (int4range, tsrange — overlap &&, contains @>)
//   - Nearest-neighbor search (ORDER BY geom <-> point)
//   - Full-text search (alternative to GIN, smaller but slower)
//
// GiST is lossy — it may return false positives that require
// a recheck against the actual row data.
//
// EXPLAIN ANALYZE before (location query without index):
//   Seq Scan on stores  (cost=0.00..15000.00 rows=100 width=128)
//     Filter: ST_DWithin(location, ST_MakePoint(-73.98, 40.75)::geography, 1000)
//     Rows Removed by Filter: 99900
//   Execution Time: 2340.5ms
//
// EXPLAIN ANALYZE after (GiST on location):
//   Index Scan using idx_stores_location on stores  (cost=0.28..120.50 rows=100 width=128)
//     Index Cond: (location && ST_Expand(ST_MakePoint(-73.98, 40.75)::geography, 1000))
//     Filter: ST_DWithin(location, ST_MakePoint(-73.98, 40.75)::geography, 1000)
//   Execution Time: 2.1ms

const gistExamples: IndexDefinition[] = [
  {
    name: "idx_stores_location",
    table: "stores",
    columns: ["location"],
    type: "gist",
    unique: false,
    concurrently: true,
  },
  {
    name: "idx_events_timerange",
    table: "events",
    columns: ["during"],
    type: "gist",
    unique: false,
    concurrently: true,
  },
];

// ─── Index Management Helpers ────────────────────────────

function generateAllIndexes(): string[] {
  const allDefs = [
    ...btreeExamples,
    ...compositeExamples,
    ...partialExamples,
    ...ginExamples,
    ...gistExamples,
  ];
  return allDefs.map(createIndexSQL);
}

function generateDropAll(): string[] {
  const allDefs = [
    ...btreeExamples,
    ...compositeExamples,
    ...partialExamples,
    ...ginExamples,
    ...gistExamples,
  ];
  return allDefs.map((def) => dropIndexSQL(def.name));
}

// ─── DEMO ────────────────────────────────────────────────

function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Postgres Indexing Strategies       ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── B-tree ──────────────────────────────────────────
  console.log("=== 1. B-tree (Default) ===\n");
  console.log("Best for: equality, range, sorting, prefix LIKE\n");
  btreeExamples.forEach((def) => console.log(createIndexSQL(def) + "\n"));

  // ── Composite ───────────────────────────────────────
  console.log("=== 2. Composite Index ===\n");
  console.log("Best for: multi-column WHERE clauses (leftmost prefix rule)\n");
  compositeExamples.forEach((def) => console.log(createIndexSQL(def) + "\n"));

  // ── Partial ─────────────────────────────────────────
  console.log("=== 3. Partial Index ===\n");
  console.log("Best for: queries targeting a small subset of rows\n");
  partialExamples.forEach((def) => console.log(createIndexSQL(def) + "\n"));

  // ── GIN ─────────────────────────────────────────────
  console.log("=== 4. GIN (Generalized Inverted Index) ===\n");
  console.log("Best for: JSONB, arrays, full-text search, trigrams\n");
  ginExamples.forEach((def) => console.log(createIndexSQL(def) + "\n"));

  // ── GiST ────────────────────────────────────────────
  console.log("=== 5. GiST (Generalized Search Tree) ===\n");
  console.log("Best for: PostGIS geometry, range types, nearest-neighbor\n");
  gistExamples.forEach((def) => console.log(createIndexSQL(def) + "\n"));

  // ── Decision Guide ──────────────────────────────────
  console.log("─────────────────────────────────────");
  console.log("DECISION GUIDE: Which index type?");
  console.log("─────────────────────────────────────\n");
  console.log("  WHERE email = ?              → B-tree (equality)");
  console.log("  WHERE created_at > ?         → B-tree (range)");
  console.log("  ORDER BY score DESC          → B-tree (sorting)");
  console.log("  WHERE name LIKE 'Ali%'       → B-tree (prefix)");
  console.log("  WHERE name LIKE '%ali%'      → GIN + pg_trgm (infix)");
  console.log("  WHERE tenant_id = ? AND ...  → Composite B-tree");
  console.log("  WHERE status = 'pending'     → Partial index");
  console.log("  WHERE metadata @> '{...}'    → GIN (JSONB containment)");
  console.log("  WHERE tags @> ARRAY[...]     → GIN (array containment)");
  console.log("  WHERE search @@ tsquery      → GIN (full-text search)");
  console.log("  WHERE ST_DWithin(geo, ...)   → GiST (PostGIS)");
  console.log("  WHERE range && int4range     → GiST (range overlap)");

  // ── Drop all indexes ────────────────────────────────
  console.log("\n=== Drop All Indexes ===\n");
  generateDropAll().forEach((sql) => console.log(sql));

  // ── Anti-patterns ───────────────────────────────────
  console.log("\n─────────────────────────────────────");
  console.log("ANTI-PATTERNS");
  console.log("─────────────────────────────────────\n");
  console.log("  1. Indexing every column");
  console.log("     Each index slows writes (INSERT/UPDATE/DELETE).");
  console.log("     Only index columns that appear in WHERE, JOIN, ORDER BY.\n");
  console.log("  2. Low-cardinality B-tree indexes");
  console.log("     A boolean column (true/false) has 2 distinct values.");
  console.log("     B-tree won't help — use a partial index instead.\n");
  console.log("  3. Unused indexes");
  console.log("     Check pg_stat_user_indexes for idx_scan = 0.");
  console.log("     DROP unused indexes to reclaim space and speed up writes.\n");
  console.log("  4. Missing CONCURRENTLY");
  console.log("     CREATE INDEX locks the table for writes.");
  console.log("     Always use CONCURRENTLY in production.\n");
  console.log("  5. Wrong composite column order");
  console.log("     Put equality columns first, then range columns.");
  console.log("     (tenant_id, created_at) not (created_at, tenant_id).");
}

main();
