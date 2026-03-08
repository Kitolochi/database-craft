/**
 * CURSOR-BASED (KEYSET) PAGINATION
 *
 * Cursor pagination uses an opaque pointer (cursor) to mark a position
 * in the result set, rather than a numeric offset. This avoids the
 * performance cliff of OFFSET-based pagination on large datasets.
 *
 * Why cursor > offset?
 *   - OFFSET N forces the DB to skip N rows (reads them, then discards).
 *     At offset 1,000,000 the DB reads 1,000,001 rows to return 1 page.
 *   - Cursor pagination uses a WHERE clause (e.g., WHERE id > :lastId)
 *     which leverages an index seek — constant time regardless of page.
 *
 * This example implements Relay-style Connection/Edge/PageInfo types
 * with base64-encoded cursors over an in-memory dataset.
 */

// ─── Types: Relay-style Connection Spec ──────────────────

/** Metadata about the current page of results */
interface PageInfo {
  /** Cursor pointing to the first item in the current page */
  startCursor: string | null;
  /** Cursor pointing to the last item in the current page */
  endCursor: string | null;
  /** True if there are more items after the last cursor (forward) */
  hasNextPage: boolean;
  /** True if there are more items before the first cursor (backward) */
  hasPreviousPage: boolean;
}

/** A single item wrapped with its cursor */
interface Edge<T> {
  /** The cursor for this specific item (used as `after` or `before`) */
  cursor: string;
  /** The actual data node */
  node: T;
}

/** The full paginated response: edges + page info + total count */
interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
  totalCount: number;
}

/** Forward pagination arguments: first N items after a cursor */
interface ForwardPaginationArgs {
  first: number;
  after?: string;
}

/** Backward pagination arguments: last N items before a cursor */
interface BackwardPaginationArgs {
  last: number;
  before?: string;
}

type PaginationArgs = ForwardPaginationArgs | BackwardPaginationArgs;

// ─── In-Memory Dataset ───────────────────────────────────
//
// In production this would be a database table with an index on
// (created_at, id) for stable cursor ordering.

interface Article {
  id: number;
  title: string;
  author: string;
  createdAt: Date;
}

function generateArticles(count: number): Article[] {
  const articles: Article[] = [];
  const authors = ["Alice", "Bob", "Carol", "Dave", "Eve"];
  const baseDate = new Date("2024-01-01T00:00:00Z");

  for (let i = 1; i <= count; i++) {
    articles.push({
      id: i,
      title: `Article #${i}: ${["Understanding", "Mastering", "Deep Dive into", "Guide to", "Exploring"][i % 5]} ${["Postgres", "Redis", "TypeScript", "Node.js", "GraphQL"][i % 5]}`,
      author: authors[i % authors.length],
      createdAt: new Date(baseDate.getTime() + i * 3600_000), // 1 hour apart
    });
  }

  return articles;
}

// 500 articles — enough to demonstrate performance difference
const ARTICLES = generateArticles(500);

// ─── Cursor Encoding / Decoding ──────────────────────────
//
// A cursor encodes enough information to uniquely identify a position.
// We use id + timestamp for stable ordering even if items are inserted
// between pages. Base64 makes it opaque to clients.
//
// SQL equivalent:
//   WHERE (created_at, id) > (:cursor_date, :cursor_id)
//   ORDER BY created_at ASC, id ASC

interface CursorPayload {
  id: number;
  ts: number; // Unix timestamp in ms
}

function encodeCursor(id: number, createdAt: Date): string {
  const payload: CursorPayload = { id, ts: createdAt.getTime() };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function decodeCursor(cursor: string): CursorPayload {
  const json = Buffer.from(cursor, "base64").toString("utf-8");
  const payload = JSON.parse(json) as CursorPayload;

  if (typeof payload.id !== "number" || typeof payload.ts !== "number") {
    throw new Error(`Invalid cursor: ${cursor}`);
  }

  return payload;
}

// ─── Cursor Pagination Implementation ────────────────────

function isForward(args: PaginationArgs): args is ForwardPaginationArgs {
  return "first" in args;
}

/**
 * Paginate through articles using cursor-based navigation.
 *
 * Forward pagination (first/after):
 *   Gets the next `first` items after the `after` cursor.
 *   SQL: WHERE (created_at, id) > (:ts, :id) ORDER BY created_at, id LIMIT :first + 1
 *
 * Backward pagination (last/before):
 *   Gets the previous `last` items before the `before` cursor.
 *   SQL: WHERE (created_at, id) < (:ts, :id) ORDER BY created_at DESC, id DESC LIMIT :last + 1
 *        then reverse the result set.
 */
function paginateArticles(args: PaginationArgs): Connection<Article> {
  const totalCount = ARTICLES.length;

  if (isForward(args)) {
    // ── Forward: first N after cursor ─────────────────
    const { first, after } = args;
    let startIndex = 0;

    if (after) {
      const { id, ts } = decodeCursor(after);
      // Find the position after the cursor (keyset seek)
      startIndex = ARTICLES.findIndex(
        (a) => a.createdAt.getTime() > ts || (a.createdAt.getTime() === ts && a.id > id)
      );
      if (startIndex === -1) startIndex = ARTICLES.length;
    }

    // Fetch one extra to determine hasNextPage
    const slice = ARTICLES.slice(startIndex, startIndex + first + 1);
    const hasNextPage = slice.length > first;
    const pageItems = hasNextPage ? slice.slice(0, first) : slice;

    const edges: Edge<Article>[] = pageItems.map((article) => ({
      cursor: encodeCursor(article.id, article.createdAt),
      node: article,
    }));

    return {
      edges,
      pageInfo: {
        startCursor: edges.length > 0 ? edges[0].cursor : null,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
        hasNextPage,
        hasPreviousPage: startIndex > 0,
      },
      totalCount,
    };
  } else {
    // ── Backward: last N before cursor ────────────────
    const { last, before } = args;
    let endIndex = ARTICLES.length;

    if (before) {
      const { id, ts } = decodeCursor(before);
      // Find items before the cursor
      endIndex = ARTICLES.findIndex(
        (a) => a.createdAt.getTime() >= ts && a.id >= id
      );
      if (endIndex === -1) endIndex = ARTICLES.length;
    }

    // Fetch one extra to determine hasPreviousPage
    const sliceStart = Math.max(0, endIndex - last - 1);
    const slice = ARTICLES.slice(sliceStart, endIndex);
    const hasPreviousPage = slice.length > last;
    const pageItems = hasPreviousPage ? slice.slice(slice.length - last) : slice;

    const edges: Edge<Article>[] = pageItems.map((article) => ({
      cursor: encodeCursor(article.id, article.createdAt),
      node: article,
    }));

    return {
      edges,
      pageInfo: {
        startCursor: edges.length > 0 ? edges[0].cursor : null,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
        hasNextPage: endIndex < ARTICLES.length,
        hasPreviousPage,
      },
      totalCount,
    };
  }
}

// ─── Offset Pagination (for comparison) ──────────────────
//
// Traditional OFFSET/LIMIT approach. Simple to implement but
// degrades on large datasets:
//   - OFFSET 100000 → DB scans 100000 rows just to skip them
//   - Results shift if rows are inserted/deleted between pages
//   - No stable position — page 50 today != page 50 tomorrow

interface OffsetPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
}

function paginateArticlesOffset(page: number, pageSize: number): OffsetPage<Article> {
  const totalCount = ARTICLES.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const offset = (page - 1) * pageSize;

  // SQL: SELECT * FROM articles ORDER BY created_at LIMIT :pageSize OFFSET :offset
  // At page 10000, this reads 10000 * pageSize rows before returning results
  const items = ARTICLES.slice(offset, offset + pageSize);

  return { items, page, pageSize, totalPages, totalCount };
}

// ─── Performance Comparison ──────────────────────────────

function measureTime<T>(label: string, fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { result, ms };
}

function comparePerformance() {
  console.log("\n=== OFFSET vs CURSOR Performance ===\n");
  console.log("Simulating access to early, middle, and late pages.\n");

  // Early page (both are fast)
  const earlyOffset = measureTime("Offset page 1", () =>
    paginateArticlesOffset(1, 10)
  );
  const earlyCursor = measureTime("Cursor page 1", () =>
    paginateArticles({ first: 10 })
  );
  console.log(`Page 1 (early):`);
  console.log(`  Offset: ${earlyOffset.ms.toFixed(3)}ms`);
  console.log(`  Cursor: ${earlyCursor.ms.toFixed(3)}ms`);

  // Middle page
  const midOffset = measureTime("Offset page 25", () =>
    paginateArticlesOffset(25, 10)
  );
  // For cursor, we'd normally have the cursor from the previous page.
  // Simulate by encoding the cursor for article at position 240.
  const midArticle = ARTICLES[239];
  const midCursor = measureTime("Cursor page 25", () =>
    paginateArticles({ first: 10, after: encodeCursor(midArticle.id, midArticle.createdAt) })
  );
  console.log(`\nPage 25 (middle):`);
  console.log(`  Offset: ${midOffset.ms.toFixed(3)}ms`);
  console.log(`  Cursor: ${midCursor.ms.toFixed(3)}ms`);

  // Late page — this is where offset degrades on real DBs
  const lateOffset = measureTime("Offset page 50", () =>
    paginateArticlesOffset(50, 10)
  );
  const lateArticle = ARTICLES[489];
  const lateCursor = measureTime("Cursor page 50", () =>
    paginateArticles({ first: 10, after: encodeCursor(lateArticle.id, lateArticle.createdAt) })
  );
  console.log(`\nPage 50 (late):`);
  console.log(`  Offset: ${lateOffset.ms.toFixed(3)}ms`);
  console.log(`  Cursor: ${lateCursor.ms.toFixed(3)}ms`);

  console.log("\n  Note: In-memory arrays have O(1) slice, so both are fast here.");
  console.log("  On a real DB with 10M rows, offset page 100000 would take");
  console.log("  seconds while cursor stays under 1ms (indexed seek).");

  // ── SQL comparison ──────────────────────────────────
  console.log("\n--- SQL Equivalents ---\n");
  console.log("  OFFSET (page 10000, 20 per page):");
  console.log("    SELECT * FROM articles ORDER BY created_at, id");
  console.log("    LIMIT 20 OFFSET 199980;");
  console.log("    -- Scans 200,000 rows, returns 20\n");
  console.log("  CURSOR (after last item on previous page):");
  console.log("    SELECT * FROM articles");
  console.log("    WHERE (created_at, id) > ('2024-06-15T12:00:00Z', 48231)");
  console.log("    ORDER BY created_at, id");
  console.log("    LIMIT 20;");
  console.log("    -- Index seek to exact position, reads 20 rows");
}

// ─── DEMO ────────────────────────────────────────────────

function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Cursor Pagination (Keyset)         ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`Dataset: ${ARTICLES.length} articles\n`);

  // ── Forward pagination ──────────────────────────────
  console.log("=== Forward Pagination (first/after) ===\n");

  // Page 1: first 5 articles
  const page1 = paginateArticles({ first: 5 });
  console.log("Page 1 (first: 5):");
  page1.edges.forEach((e) =>
    console.log(`  [${e.node.id}] ${e.node.title} — ${e.node.author}`)
  );
  console.log(`  PageInfo: hasNext=${page1.pageInfo.hasNextPage}, hasPrev=${page1.pageInfo.hasPreviousPage}`);
  console.log(`  endCursor: ${page1.pageInfo.endCursor}`);

  // Page 2: next 5 after page 1's endCursor
  const page2 = paginateArticles({ first: 5, after: page1.pageInfo.endCursor! });
  console.log("\nPage 2 (first: 5, after: endCursor):");
  page2.edges.forEach((e) =>
    console.log(`  [${e.node.id}] ${e.node.title} — ${e.node.author}`)
  );
  console.log(`  PageInfo: hasNext=${page2.pageInfo.hasNextPage}, hasPrev=${page2.pageInfo.hasPreviousPage}`);

  // Page 3
  const page3 = paginateArticles({ first: 5, after: page2.pageInfo.endCursor! });
  console.log("\nPage 3 (first: 5, after: endCursor):");
  page3.edges.forEach((e) =>
    console.log(`  [${e.node.id}] ${e.node.title} — ${e.node.author}`)
  );
  console.log(`  PageInfo: hasNext=${page3.pageInfo.hasNextPage}, hasPrev=${page3.pageInfo.hasPreviousPage}`);

  // ── Backward pagination ─────────────────────────────
  console.log("\n=== Backward Pagination (last/before) ===\n");

  // Go back from page 3's start cursor
  const prevPage = paginateArticles({ last: 5, before: page3.pageInfo.startCursor! });
  console.log("Previous page (last: 5, before: page3.startCursor):");
  prevPage.edges.forEach((e) =>
    console.log(`  [${e.node.id}] ${e.node.title} — ${e.node.author}`)
  );
  console.log(`  PageInfo: hasNext=${prevPage.pageInfo.hasNextPage}, hasPrev=${prevPage.pageInfo.hasPreviousPage}`);
  console.log("  (Should match page 2 above)");

  // ── Cursor encoding demo ────────────────────────────
  console.log("\n=== Cursor Encoding ===\n");
  const sampleCursor = encodeCursor(42, new Date("2024-01-15T10:00:00Z"));
  console.log(`  Encoded: ${sampleCursor}`);
  const decoded = decodeCursor(sampleCursor);
  console.log(`  Decoded: id=${decoded.id}, ts=${new Date(decoded.ts).toISOString()}`);
  console.log("  Cursor is opaque to clients — base64(JSON({id, timestamp}))");

  // ── Offset comparison ───────────────────────────────
  console.log("\n=== Offset Pagination (for comparison) ===\n");
  const offsetPage = paginateArticlesOffset(2, 5);
  console.log(`Page ${offsetPage.page} of ${offsetPage.totalPages} (${offsetPage.pageSize}/page):`);
  offsetPage.items.forEach((a) =>
    console.log(`  [${a.id}] ${a.title} — ${a.author}`)
  );

  // ── Performance comparison ──────────────────────────
  comparePerformance();

  // ── When to use each approach ───────────────────────
  console.log("\n─────────────────────────────────────");
  console.log("DECISION GUIDE");
  console.log("─────────────────────────────────────");
  console.log("Use OFFSET when:");
  console.log("  - Dataset is small (< 10k rows)");
  console.log("  - Users need to jump to arbitrary pages (page 1, 50, 100)");
  console.log("  - Admin dashboards with page number navigation");
  console.log("\nUse CURSOR when:");
  console.log("  - Dataset is large (> 10k rows)");
  console.log("  - Infinite scroll / load more UI");
  console.log("  - Real-time feeds (items inserted between pages)");
  console.log("  - API pagination (GraphQL Relay spec)");
  console.log("  - Performance must stay constant regardless of page depth");
}

main();
