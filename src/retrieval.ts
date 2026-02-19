/**
 * Credit-Weighted Retrieval
 *
 * Enhances standard memory search by incorporating credit scores
 * into the ranking function. The final score blends:
 *   - Semantic similarity (embedding cosine distance)
 *   - BM25 keyword score
 *   - Credit score (outcome-aware utility)
 *   - Recency decay
 */

import type {
  MemoryDocument,
  SearchResult,
  RetrievalQuery,
  PluginConfig,
} from './types';
import { MemoryStore } from './memory-store';
import { MetadataDB } from './utils/db';
import { LocalEmbedder, BM25Scorer } from './utils/embeddings';
import { estimateTokens } from './utils/markdown-parser';

/** Weights for the composite scoring function. */
interface ScoringWeights {
  semanticSimilarity: number;
  bm25: number;
  credit: number;
  recency: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  semanticSimilarity: 0.4,
  bm25: 0.2,
  credit: 0.25,
  recency: 0.15,
};

export class RetrievalEngine {
  private store: MemoryStore;
  private db: MetadataDB;
  private config: PluginConfig;
  private embedder: LocalEmbedder;
  private bm25: BM25Scorer;
  private weights: ScoringWeights;
  private indexed: boolean = false;

  constructor(
    store: MemoryStore,
    db: MetadataDB,
    config: PluginConfig,
    weights?: Partial<ScoringWeights>,
  ) {
    this.store = store;
    this.db = db;
    this.config = config;
    this.embedder = new LocalEmbedder();
    this.bm25 = new BM25Scorer();
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Build the search index from all memory documents.
   * Should be called at session start or after significant changes.
   */
  buildIndex(): void {
    const docs = this.store.listAll();

    for (const doc of docs) {
      const text = this.documentToText(doc);
      this.embedder.indexDocument(text);
      this.bm25.indexDocument(doc.id, text);
    }

    this.indexed = true;
  }

  /**
   * Add a single document to the search index.
   */
  addToIndex(doc: MemoryDocument): void {
    const text = this.documentToText(doc);
    this.embedder.indexDocument(text);
    this.bm25.indexDocument(doc.id, text);
  }

  /**
   * Remove a document from the search index.
   */
  removeFromIndex(docId: string): void {
    this.bm25.removeDocument(docId);
  }

  /**
   * Search memories with credit-weighted ranking.
   */
  search(query: RetrievalQuery): SearchResult[] {
    if (!this.indexed) {
      this.buildIndex();
    }

    const docs = this.store.listAll();
    const queryEmbedding = this.embedder.embed(query.text);
    const creditScores = this.db.getAllCreditScores();
    const now = Date.now();

    const results: SearchResult[] = [];

    for (const doc of docs) {
      // Apply tag filter
      if (
        query.tags &&
        query.tags.length > 0 &&
        !query.tags.some((t) => doc.frontmatter.tags.includes(t))
      ) {
        continue;
      }

      // Apply entity filter
      if (
        query.entities &&
        query.entities.length > 0 &&
        doc.frontmatter.entities
      ) {
        const hasEntity = query.entities.some((e) =>
          doc.frontmatter.entities!.includes(e),
        );
        if (!hasEntity) continue;
      }

      // Apply minimum credit score filter
      const credit = creditScores.get(doc.id) ?? 0.5;
      if (query.minCreditScore !== undefined && credit < query.minCreditScore) {
        continue;
      }

      // Compute individual scores
      const docText = this.documentToText(doc);
      const docEmbedding = this.embedder.embed(docText);
      const semanticSim = LocalEmbedder.cosineSimilarity(
        queryEmbedding,
        docEmbedding,
      );
      const bm25Score = this.bm25.score(doc.id, query.text);
      const recencyScore = this.computeRecencyScore(
        doc.frontmatter.updated,
        now,
      );

      // Normalize BM25 score to [0, 1] range
      const normalizedBm25 = Math.min(bm25Score / 10, 1.0);

      // Composite score
      const finalScore =
        this.weights.semanticSimilarity * semanticSim +
        this.weights.bm25 * normalizedBm25 +
        this.weights.credit * credit +
        this.weights.recency * recencyScore;

      results.push({
        memoryId: doc.id,
        document: doc,
        semanticSimilarity: semanticSim,
        bm25Score: normalizedBm25,
        creditScore: credit,
        recencyScore,
        finalScore,
      });
    }

    // Sort by final score descending
    results.sort((a, b) => b.finalScore - a.finalScore);

    // Apply limit
    const maxResults = query.maxResults ?? 10;
    return results.slice(0, maxResults);
  }

  /**
   * Quick search for entities matching a query text.
   * Uses BM25 only for speed.
   */
  quickSearch(queryText: string, limit: number = 5): MemoryDocument[] {
    if (!this.indexed) {
      this.buildIndex();
    }

    const bm25Results = this.bm25.scoreAll(queryText);
    const results: MemoryDocument[] = [];

    for (const { docId } of bm25Results.slice(0, limit)) {
      const doc = this.store.getById(docId);
      if (doc) results.push(doc);
    }

    return results;
  }

  /**
   * Get the top-N highest credit memories.
   * Useful for MEMORY.md generation.
   */
  getTopCreditMemories(n: number): SearchResult[] {
    const docs = this.store.listAll();
    const creditScores = this.db.getAllCreditScores();

    const results: SearchResult[] = docs.map((doc) => ({
      memoryId: doc.id,
      document: doc,
      semanticSimilarity: 0,
      bm25Score: 0,
      creditScore: creditScores.get(doc.id) ?? 0.5,
      recencyScore: this.computeRecencyScore(
        doc.frontmatter.updated,
        Date.now(),
      ),
      finalScore: creditScores.get(doc.id) ?? 0.5,
    }));

    results.sort((a, b) => b.creditScore - a.creditScore);
    return results.slice(0, n);
  }

  /**
   * Retrieve memories within a token budget, prioritized by score.
   */
  retrieveWithinBudget(
    query: RetrievalQuery,
    tokenBudget: number,
  ): SearchResult[] {
    const allResults = this.search({
      ...query,
      maxResults: 50, // Get extra, then trim by budget
    });

    const selected: SearchResult[] = [];
    let usedTokens = 0;

    for (const result of allResults) {
      const docTokens = estimateTokens(
        result.document.body + result.document.frontmatter.name,
      );
      if (usedTokens + docTokens > tokenBudget) continue;
      selected.push(result);
      usedTokens += docTokens;
    }

    return selected;
  }

  /**
   * Compute a recency score that decays over time.
   * Returns a value in [0, 1] where 1 = today, 0 = very old.
   */
  private computeRecencyScore(dateStr: string, nowMs: number): number {
    const docDate = new Date(dateStr).getTime();
    const ageMs = nowMs - docDate;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Exponential decay with half-life of 14 days
    return Math.exp(-ageDays * (Math.LN2 / 14));
  }

  /**
   * Convert a memory document to a searchable text string.
   */
  private documentToText(doc: MemoryDocument): string {
    const parts: string[] = [
      doc.frontmatter.name,
      doc.frontmatter.tags.join(' '),
      doc.body,
    ];
    if (doc.frontmatter.entities) {
      parts.push(doc.frontmatter.entities.join(' '));
    }
    return parts.join(' ');
  }
}
