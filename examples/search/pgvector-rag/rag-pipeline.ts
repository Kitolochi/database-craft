import { VectorStore, fakeEmbedding } from "./vector-search.js";

/**
 * RAG (Retrieval-Augmented Generation) pipeline.
 *
 * 1. User asks a question
 * 2. Retrieve relevant documents from vector store
 * 3. Build a prompt with retrieved context
 * 4. Send to LLM for grounded answer
 *
 * This demo shows the retrieval and prompt construction steps.
 * In production, step 4 calls an actual LLM API.
 */

interface RAGResult {
  question: string;
  retrievedDocs: Array<{ content: string; score: number }>;
  constructedPrompt: string;
  simulatedAnswer: string;
}

function createRAGPipeline(store: VectorStore) {
  return {
    query(question: string, topK: number = 3): RAGResult {
      // Step 1: Embed the question
      const questionEmbedding = fakeEmbedding(question);

      // Step 2: Retrieve relevant documents
      const results = store.search(questionEmbedding, topK);
      const retrievedDocs = results.map((r) => ({
        content: r.document.content,
        score: r.score,
      }));

      // Step 3: Construct prompt with context
      const context = retrievedDocs
        .map((doc, i) => `[${i + 1}] ${doc.content}`)
        .join("\n");

      const constructedPrompt = `Answer the question based on the following context. If the context doesn't contain enough information, say so.

Context:
${context}

Question: ${question}

Answer:`;

      // Step 4: In production, send to LLM. Here we simulate.
      const simulatedAnswer = `Based on the retrieved context, here are the relevant points:\n${retrievedDocs
        .map((d) => `- ${d.content}`)
        .join("\n")}`;

      return { question, retrievedDocs, constructedPrompt, simulatedAnswer };
    },
  };
}

// ---- Demo ----

function demo() {
  console.log("=== RAG Pipeline Demo ===\n");

  const store = new VectorStore();

  // Knowledge base
  const docs = [
    "pgvector supports three distance functions: L2 distance, inner product, and cosine distance",
    "HNSW indexes in pgvector provide fast approximate nearest neighbor search with configurable accuracy",
    "Create a vector column: ALTER TABLE items ADD COLUMN embedding vector(384)",
    "The IVFFlat index is faster to build but less accurate than HNSW for large datasets",
    "Use vector_cosine_ops for cosine similarity: CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops)",
    "Embeddings should be normalized for cosine similarity to work correctly",
    "Batch insert embeddings for better performance: INSERT INTO items (embedding) VALUES ($1), ($2), ($3)",
    "pgvector 0.7+ supports half-precision vectors (halfvec) for 2x storage savings",
    "Hybrid search combines full-text search (tsvector) with vector similarity for better results",
    "Set hnsw.ef_search to control the speed/accuracy tradeoff at query time",
  ];

  for (let i = 0; i < docs.length; i++) {
    store.add(`doc-${i + 1}`, docs[i], fakeEmbedding(docs[i]));
  }

  // Run queries
  const questions = [
    "How do I create a vector index in PostgreSQL?",
    "What distance functions does pgvector support?",
    "How can I improve search accuracy?",
  ];

  for (const question of questions) {
    const result = createRAGPipeline(store).query(question);

    console.log(`Q: ${result.question}`);
    console.log(`\nRetrieved (top 3):`);
    for (const doc of result.retrievedDocs) {
      console.log(`  [${doc.score.toFixed(4)}] ${doc.content}`);
    }
    console.log(`\nConstructed prompt:\n${result.constructedPrompt}`);
    console.log("\n" + "\u2500".repeat(60) + "\n");
  }
}

demo();
