import { Pool, QueryResult } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/mydb",
  max: 10,
});

interface SearchResult {
  id: number;
  title: string;
  body: string;
  author: string;
  category: string | null;
  rank: number;
  headline: string;
}

interface SearchOptions {
  category?: string;
  publishedOnly?: boolean;
  limit?: number;
  offset?: number;
}

// ─── Basic Full-Text Search ──────────────────────────────

/**
 * Search articles using plainto_tsquery (simple text input).
 * Postgres handles stemming: "running" matches "run", "runs", etc.
 */
async function searchArticles(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { category, publishedOnly = true, limit = 20, offset = 0 } = options;

  const conditions: string[] = ["a.search_vector @@ plainto_tsquery('english', $1)"];
  const params: (string | number | boolean)[] = [query];
  let paramIndex = 2;

  if (publishedOnly) {
    conditions.push("a.published = true");
  }

  if (category) {
    conditions.push(`a.category = $${paramIndex}`);
    params.push(category);
    paramIndex++;
  }

  params.push(limit, offset);

  const sql = `
    SELECT
      a.id,
      a.title,
      a.body,
      a.author,
      a.category,
      -- ts_rank scores results by relevance (higher = better match)
      -- Weights: {D, C, B, A} = {0.1, 0.2, 0.4, 1.0}
      ts_rank(
        a.search_vector,
        plainto_tsquery('english', $1),
        32  -- flag: rank / (rank + 1) for normalization
      ) AS rank,
      -- ts_headline generates a snippet with matching terms highlighted
      ts_headline(
        'english',
        a.body,
        plainto_tsquery('english', $1),
        'StartSel=<<, StopSel=>>, MaxWords=35, MinWords=15'
      ) AS headline
    FROM articles a
    WHERE ${conditions.join(" AND ")}
    ORDER BY rank DESC, a.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const result = await pool.query(sql, params);
  return result.rows;
}

// ─── Phrase Search ───────────────────────────────────────

/**
 * Search for an exact phrase using phraseto_tsquery.
 * Matches words in exact order: "full text" matches "full-text search"
 * but NOT "text that is full".
 */
async function phraseSearch(
  phrase: string,
  limit: number = 20
): Promise<SearchResult[]> {
  const sql = `
    SELECT
      a.id,
      a.title,
      a.author,
      a.body,
      a.category,
      ts_rank(a.search_vector, phraseto_tsquery('english', $1)) AS rank,
      ts_headline(
        'english',
        a.body,
        phraseto_tsquery('english', $1),
        'StartSel=<<, StopSel=>>, MaxWords=35, MinWords=15'
      ) AS headline
    FROM articles a
    WHERE a.search_vector @@ phraseto_tsquery('english', $1)
      AND a.published = true
    ORDER BY rank DESC
    LIMIT $2
  `;

  const result = await pool.query(sql, [phrase, limit]);
  return result.rows;
}

// ─── Advanced: Boolean Query ─────────────────────────────

/**
 * Search with boolean operators using to_tsquery.
 * Supports: & (AND), | (OR), ! (NOT), <-> (followed by)
 *
 * Examples:
 *   "postgres & index"       — both words
 *   "postgres | mysql"       — either word
 *   "postgres & !mysql"      — postgres but not mysql
 *   "full <-> text"          — "full" followed by "text"
 */
async function booleanSearch(
  tsquery: string,
  limit: number = 20
): Promise<SearchResult[]> {
  const sql = `
    SELECT
      a.id,
      a.title,
      a.author,
      a.body,
      a.category,
      ts_rank(a.search_vector, to_tsquery('english', $1)) AS rank,
      ts_headline(
        'english',
        a.body,
        to_tsquery('english', $1),
        'StartSel=<<, StopSel=>>, MaxWords=35, MinWords=15'
      ) AS headline
    FROM articles a
    WHERE a.search_vector @@ to_tsquery('english', $1)
      AND a.published = true
    ORDER BY rank DESC
    LIMIT $2
  `;

  const result = await pool.query(sql, [tsquery, limit]);
  return result.rows;
}

// ─── Search Suggestions (autocomplete) ───────────────────

/**
 * Get distinct words from the search corpus that match a prefix.
 * Useful for "search as you type" suggestions.
 */
async function searchSuggestions(
  prefix: string,
  limit: number = 10
): Promise<string[]> {
  const sql = `
    SELECT DISTINCT word
    FROM ts_stat('SELECT search_vector FROM articles WHERE published = true')
    WHERE word LIKE $1
    ORDER BY nentry DESC, word
    LIMIT $2
  `;

  const result = await pool.query(sql, [`${prefix}%`, limit]);
  return result.rows.map((r) => r.word);
}

// ─── Search with Count ───────────────────────────────────

async function searchWithCount(
  query: string,
  options: SearchOptions = {}
): Promise<{ results: SearchResult[]; total: number }> {
  const { category, publishedOnly = true, limit = 20, offset = 0 } = options;

  const conditions: string[] = ["a.search_vector @@ plainto_tsquery('english', $1)"];
  const params: (string | number | boolean)[] = [query];
  let paramIndex = 2;

  if (publishedOnly) {
    conditions.push("a.published = true");
  }
  if (category) {
    conditions.push(`a.category = $${paramIndex}`);
    params.push(category);
    paramIndex++;
  }

  const whereClause = conditions.join(" AND ");

  // Run count and search in parallel
  const countParams = params.slice(); // copy without limit/offset
  params.push(limit, offset);

  const [countResult, searchResult] = await Promise.all([
    pool.query(`SELECT count(*) FROM articles a WHERE ${whereClause}`, countParams),
    pool.query(
      `
      SELECT
        a.id, a.title, a.body, a.author, a.category,
        ts_rank(a.search_vector, plainto_tsquery('english', $1), 32) AS rank,
        ts_headline('english', a.body, plainto_tsquery('english', $1),
          'StartSel=<<, StopSel=>>, MaxWords=35, MinWords=15') AS headline
      FROM articles a
      WHERE ${whereClause}
      ORDER BY rank DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
      params
    ),
  ]);

  return {
    results: searchResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

// ─── DEMO ────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║  Postgres Full-Text Search Demo      ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Basic search
  console.log('--- Basic Search: "postgresql index" ---');
  const results = await searchArticles("postgresql index");
  results.forEach((r) => {
    console.log(`  [${r.rank.toFixed(3)}] ${r.title}`);
    console.log(`         ${r.headline}\n`);
  });

  // Phrase search
  console.log('--- Phrase Search: "full text search" ---');
  const phraseResults = await phraseSearch("full text search");
  phraseResults.forEach((r) => {
    console.log(`  [${r.rank.toFixed(3)}] ${r.title}`);
  });

  // Boolean search
  console.log('\n--- Boolean Search: "postgres & !mysql" ---');
  const boolResults = await booleanSearch("postgres & !mysql");
  boolResults.forEach((r) => {
    console.log(`  [${r.rank.toFixed(3)}] ${r.title}`);
  });

  // Category filter
  console.log('\n--- Filtered Search: "query" in category "database" ---');
  const filtered = await searchArticles("query", { category: "database" });
  filtered.forEach((r) => {
    console.log(`  [${r.rank.toFixed(3)}] ${r.title} (${r.category})`);
  });

  // Suggestions
  console.log('\n--- Autocomplete Suggestions: "post" ---');
  const suggestions = await searchSuggestions("post");
  console.log(`  Suggestions: ${suggestions.join(", ")}`);

  // Search with count
  console.log('\n--- Search with Count: "database" ---');
  const { results: counted, total } = await searchWithCount("database");
  console.log(`  Found ${total} results (showing ${counted.length})`);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
