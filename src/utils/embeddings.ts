/**
 * Embedding utilities for memory search.
 *
 * Provides a simple local embedding implementation based on
 * term-frequency vectors, with hooks for external providers.
 */

/**
 * A simple term-frequency based embedding for local use.
 *
 * This is a lightweight alternative to neural embeddings.
 * For production use, plug in an external embedding provider
 * via the config.
 */
export class LocalEmbedder {
  private vocabulary: Map<string, number> = new Map();
  private nextIdx: number = 0;
  private idfCounts: Map<string, number> = new Map();
  private documentCount: number = 0;

  /**
   * Tokenize text into normalized terms.
   */
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  /**
   * Index a document to build vocabulary and IDF stats.
   */
  indexDocument(text: string): void {
    const tokens = this.tokenize(text);
    const seen = new Set<string>();

    for (const token of tokens) {
      if (!this.vocabulary.has(token)) {
        this.vocabulary.set(token, this.nextIdx++);
      }
      if (!seen.has(token)) {
        seen.add(token);
        this.idfCounts.set(token, (this.idfCounts.get(token) ?? 0) + 1);
      }
    }
    this.documentCount++;
  }

  /**
   * Generate a sparse TF-IDF vector for a text.
   */
  embed(text: string): Float32Array {
    const tokens = this.tokenize(text);
    const termFreqs = new Map<string, number>();

    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }

    const vector = new Float32Array(this.vocabulary.size);

    for (const [term, freq] of termFreqs) {
      const idx = this.vocabulary.get(term);
      if (idx === undefined) continue;

      const tf = freq / tokens.length;
      const docFreq = this.idfCounts.get(term) ?? 1;
      const idf = Math.log((this.documentCount + 1) / (docFreq + 1)) + 1;

      vector[idx] = tf * idf;
    }

    return vector;
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Vocabulary size (for testing/debugging).
   */
  get vocabSize(): number {
    return this.vocabulary.size;
  }
}

/**
 * BM25 scoring for keyword-based retrieval.
 */
export class BM25Scorer {
  private k1: number;
  private b: number;
  private avgDocLength: number = 0;
  private docLengths: Map<string, number> = new Map();
  private docFreqs: Map<string, number> = new Map();
  private docTermFreqs: Map<string, Map<string, number>> = new Map();
  private totalDocs: number = 0;

  constructor(k1: number = 1.5, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  /**
   * Tokenize text into terms.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  /**
   * Index a document for BM25 scoring.
   */
  indexDocument(docId: string, text: string): void {
    const tokens = this.tokenize(text);
    this.docLengths.set(docId, tokens.length);
    this.totalDocs++;

    const totalLength = Array.from(this.docLengths.values()).reduce(
      (sum, l) => sum + l,
      0,
    );
    this.avgDocLength = totalLength / this.totalDocs;

    const termFreqs = new Map<string, number>();
    const seenTerms = new Set<string>();

    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
      if (!seenTerms.has(token)) {
        seenTerms.add(token);
        this.docFreqs.set(token, (this.docFreqs.get(token) ?? 0) + 1);
      }
    }

    this.docTermFreqs.set(docId, termFreqs);
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(docId: string): void {
    const termFreqs = this.docTermFreqs.get(docId);
    if (!termFreqs) return;

    for (const term of termFreqs.keys()) {
      const df = this.docFreqs.get(term);
      if (df !== undefined) {
        if (df <= 1) {
          this.docFreqs.delete(term);
        } else {
          this.docFreqs.set(term, df - 1);
        }
      }
    }

    this.docTermFreqs.delete(docId);
    this.docLengths.delete(docId);
    this.totalDocs--;

    if (this.totalDocs > 0) {
      const totalLength = Array.from(this.docLengths.values()).reduce(
        (sum, l) => sum + l,
        0,
      );
      this.avgDocLength = totalLength / this.totalDocs;
    } else {
      this.avgDocLength = 0;
    }
  }

  /**
   * Score a document against a query.
   */
  score(docId: string, query: string): number {
    const queryTokens = this.tokenize(query);
    const docTermFreqs = this.docTermFreqs.get(docId);
    const docLength = this.docLengths.get(docId);

    if (!docTermFreqs || docLength === undefined) return 0;

    let totalScore = 0;

    for (const term of queryTokens) {
      const tf = docTermFreqs.get(term) ?? 0;
      if (tf === 0) continue;

      const df = this.docFreqs.get(term) ?? 0;
      const idf = Math.log(
        (this.totalDocs - df + 0.5) / (df + 0.5) + 1,
      );

      const numerator = tf * (this.k1 + 1);
      const denominator =
        tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));

      totalScore += idf * (numerator / denominator);
    }

    return totalScore;
  }

  /**
   * Score all indexed documents against a query, returning sorted results.
   */
  scoreAll(query: string): { docId: string; score: number }[] {
    const results: { docId: string; score: number }[] = [];

    for (const docId of this.docTermFreqs.keys()) {
      const s = this.score(docId, query);
      if (s > 0) {
        results.push({ docId, score: s });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}
