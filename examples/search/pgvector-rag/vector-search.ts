/**
 * In-memory vector search demonstrating the concepts behind pgvector.
 *
 * In production, use PostgreSQL + pgvector:
 *   CREATE EXTENSION vector;
 *   CREATE TABLE documents (
 *     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     content text,
 *     embedding vector(384)
 *   );
 *   CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
 *   SELECT * FROM documents ORDER BY embedding <=> $1 LIMIT 5;
 */

// ---- Types ----

interface Document {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, string>;
}

// ---- Similarity Functions ----

/**
 * Cosine similarity: measures angle between vectors.
 * Range: -1 to 1 (1 = identical direction)
 * Best for: text embeddings (normalized by default)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Euclidean distance (L2): measures straight-line distance.
 * Range: 0 to Infinity (0 = identical)
 * Best for: spatial data, image features
 */
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Inner product: dot product without normalization.
 * Range: -Infinity to Infinity (higher = more similar)
 * Best for: when vectors are already normalized (same as cosine then)
 */
export function innerProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// ---- In-Memory Vector Store ----

export class VectorStore {
  private documents: Document[] = [];

  add(id: string, content: string, embedding: number[], metadata?: Record<string, string>): void {
    this.documents.push({ id, content, embedding, metadata });
  }

  /**
   * Brute-force search (exact nearest neighbors).
   * pgvector equivalent: ORDER BY embedding <=> query_embedding
   *
   * Time complexity: O(n) — scans every document.
   * Fine for < 100K documents. Use HNSW index for larger datasets.
   */
  search(queryEmbedding: number[], topK: number = 5): Array<{ document: Document; score: number }> {
    const scored = this.documents.map((doc) => ({
      document: doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Hybrid search: combine vector similarity with keyword matching.
   * pgvector + tsvector equivalent:
   *   SELECT *, (semantic_score * 0.7 + keyword_score * 0.3) as hybrid_score
   *   FROM documents
   *   ORDER BY hybrid_score DESC
   */
  hybridSearch(
    queryEmbedding: number[],
    keywords: string[],
    topK: number = 5,
    semanticWeight: number = 0.7
  ): Array<{ document: Document; score: number; semanticScore: number; keywordScore: number }> {
    const keywordWeight = 1 - semanticWeight;
    const lowerKeywords = keywords.map((k) => k.toLowerCase());

    const scored = this.documents.map((doc) => {
      const semanticScore = cosineSimilarity(queryEmbedding, doc.embedding);
      const words = doc.content.toLowerCase().split(/\s+/);
      const matchCount = lowerKeywords.filter((kw) => words.some((w) => w.includes(kw))).length;
      const keywordScore = lowerKeywords.length > 0 ? matchCount / lowerKeywords.length : 0;

      return {
        document: doc,
        semanticScore,
        keywordScore,
        score: semanticScore * semanticWeight + keywordScore * keywordWeight,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get size(): number {
    return this.documents.length;
  }
}

// ---- Fake Embeddings (for demo) ----

/**
 * Generate a fake embedding based on word overlap.
 * In production, use an embedding model (OpenAI, Cohere, local Sentence Transformers).
 */
export function fakeEmbedding(text: string, dimensions: number = 64): number[] {
  const words = text.toLowerCase().split(/\s+/);
  const embedding = new Array(dimensions).fill(0);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    // Distribute word influence across embedding dimensions
    for (let d = 0; d < dimensions; d++) {
      embedding[d] += Math.sin(hash * (d + 1)) * 0.1;
    }
  }

  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? embedding.map((v) => v / norm) : embedding;
}

// ---- Demo ----

function demo() {
  console.log("=== In-Memory Vector Search Demo ===\n");

  const store = new VectorStore();

  // Sample documents
  const documents = [
    { id: "1", content: "PostgreSQL is a powerful relational database with ACID compliance" },
    { id: "2", content: "pgvector adds vector similarity search to PostgreSQL" },
    { id: "3", content: "Redis is an in-memory key-value store for caching" },
    { id: "4", content: "MongoDB is a document database with flexible schemas" },
    { id: "5", content: "Drizzle ORM provides type-safe database queries for TypeScript" },
    { id: "6", content: "Vector embeddings represent semantic meaning as numbers" },
    { id: "7", content: "HNSW indexes enable fast approximate nearest neighbor search" },
    { id: "8", content: "RAG combines retrieval with language models for grounded answers" },
    { id: "9", content: "Semantic search understands meaning beyond keyword matching" },
    { id: "10", content: "Database indexing improves query performance through B-trees" },
  ];

  for (const doc of documents) {
    store.add(doc.id, doc.content, fakeEmbedding(doc.content));
  }

  console.log(`Indexed ${store.size} documents\n`);

  // Semantic search
  const query = "How do I search by meaning in a database?";
  console.log(`Query: "${query}"\n`);

  console.log("--- Semantic Search (cosine similarity) ---");
  const queryEmb = fakeEmbedding(query);
  const results = store.search(queryEmb, 3);
  for (const { document, score } of results) {
    console.log(`  [${score.toFixed(4)}] ${document.content}`);
  }

  // Hybrid search
  console.log("\n--- Hybrid Search (semantic + keyword) ---");
  const hybrid = store.hybridSearch(queryEmb, ["database", "search"], 3);
  for (const { document, score, semanticScore, keywordScore } of hybrid) {
    console.log(`  [${score.toFixed(4)}] (sem=${semanticScore.toFixed(3)}, kw=${keywordScore.toFixed(3)}) ${document.content}`);
  }

  // Distance function comparison
  console.log("\n--- Distance Functions ---");
  const a = fakeEmbedding("PostgreSQL vector search");
  const b = fakeEmbedding("Database similarity query");
  const c = fakeEmbedding("Chocolate cake recipe");

  console.log(`  "PostgreSQL vector search" vs "Database similarity query":`);
  console.log(`    Cosine similarity: ${cosineSimilarity(a, b).toFixed(4)}`);
  console.log(`    Euclidean distance: ${euclideanDistance(a, b).toFixed(4)}`);
  console.log(`    Inner product: ${innerProduct(a, b).toFixed(4)}`);
  console.log(`  "PostgreSQL vector search" vs "Chocolate cake recipe":`);
  console.log(`    Cosine similarity: ${cosineSimilarity(a, c).toFixed(4)}`);
  console.log(`    Euclidean distance: ${euclideanDistance(a, c).toFixed(4)}`);
  console.log(`    Inner product: ${innerProduct(a, c).toFixed(4)}`);
}

demo();
