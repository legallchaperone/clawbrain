/**
 * Contradiction Detection and Resolution
 *
 * Detects conflicting facts within entity documents and manages
 * their resolution. When an entity is updated with new information
 * that conflicts with existing facts, the system either:
 * - Treats it as an update (new info supersedes old)
 * - Flags it as a genuine conflict for user review
 *
 * Uses text similarity to identify potential contradictions,
 * then applies heuristics to classify them.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  Contradiction,
  EntityDocument,
  HistoryEntry,
  PluginConfig,
} from './types';
import { MetadataDB } from './utils/db';
import { LocalEmbedder } from './utils/embeddings';

/** Similarity threshold above which facts are considered potentially contradictory. */
const SIMILARITY_THRESHOLD = 0.6;

/** Patterns that indicate temporal supersession (the new fact updates the old). */
const UPDATE_INDICATORS = [
  /\bnow\b/i,
  /\bpromoted?\b/i,
  /\bchanged?\b/i,
  /\bupgraded?\b/i,
  /\bmoved?\b/i,
  /\bswitched?\b/i,
  /\bnew\b/i,
  /\bformer(ly)?\b/i,
  /\bprevious(ly)?\b/i,
  /\bupdated?\b/i,
  /\breplaced?\b/i,
  /\bno\s+longer\b/i,
  /\binstead\b/i,
  /\bwas\b.*\bis\b/i,
];

/** Patterns that indicate the fact is a negation or reversal. */
const NEGATION_PATTERNS = [
  /\bnot\b/i,
  /\bno\b/i,
  /\bnever\b/i,
  /\bdon'?t\b/i,
  /\bdoesn'?t\b/i,
  /\bwon'?t\b/i,
  /\bcan'?t\b/i,
  /\bisn'?t\b/i,
  /\baren'?t\b/i,
  /\bwasn'?t\b/i,
];

export class ContradictionDetector {
  private db: MetadataDB;
  private config: PluginConfig;
  private embedder: LocalEmbedder;

  constructor(db: MetadataDB, config: PluginConfig) {
    this.db = db;
    this.config = config;
    this.embedder = new LocalEmbedder();
  }

  /**
   * Check a new fact against existing facts in an entity.
   * Returns any detected contradictions.
   */
  checkForContradictions(
    entity: EntityDocument,
    newFact: string,
  ): Contradiction[] {
    if (!this.config.enableContradictionDetection) return [];

    const existingFacts = this.extractFacts(entity);
    const contradictions: Contradiction[] = [];

    // Index all facts
    for (const fact of existingFacts) {
      this.embedder.indexDocument(fact);
    }
    this.embedder.indexDocument(newFact);

    const newEmbedding = this.embedder.embed(newFact);

    for (const existingFact of existingFacts) {
      const existingEmbedding = this.embedder.embed(existingFact);
      const similarity = LocalEmbedder.cosineSimilarity(
        newEmbedding,
        existingEmbedding,
      );

      if (similarity >= SIMILARITY_THRESHOLD) {
        // High similarity but different content = potential contradiction
        if (!this.isExactDuplicate(existingFact, newFact)) {
          const contradiction: Contradiction = {
            id: uuidv4(),
            entityId: entity.id,
            existingFact,
            newFact,
            detectedAt: new Date().toISOString(),
            resolved: false,
          };
          contradictions.push(contradiction);
        }
      }
    }

    return contradictions;
  }

  /**
   * Classify a contradiction as an update or a genuine conflict.
   *
   * Heuristic classification:
   * - If new fact contains update indicators -> update
   * - If new fact contains negation of existing -> update
   * - If facts are about the same property but with different values -> update
   * - Otherwise -> conflict (needs user review)
   */
  classifyContradiction(
    contradiction: Contradiction,
  ): 'update' | 'conflict' | 'duplicate' {
    const { existingFact, newFact } = contradiction;

    // Check for exact or near-exact duplicates
    if (this.isExactDuplicate(existingFact, newFact)) {
      return 'duplicate';
    }

    // Check if new fact contains temporal update indicators
    const hasUpdateIndicator = UPDATE_INDICATORS.some((pattern) =>
      pattern.test(newFact),
    );

    // Check if there's a negation relationship
    const existingHasNegation = NEGATION_PATTERNS.some((p) =>
      p.test(existingFact),
    );
    const newHasNegation = NEGATION_PATTERNS.some((p) => p.test(newFact));
    const negationFlip = existingHasNegation !== newHasNegation;

    // Check if the facts share a subject but differ in predicate
    const sharedSubject = this.hasSharedSubject(existingFact, newFact);

    if (hasUpdateIndicator || negationFlip || sharedSubject) {
      return 'update';
    }

    return 'conflict';
  }

  /**
   * Resolve a contradiction by applying the classification.
   *
   * - update: Replace old fact in entity, add to history
   * - conflict: Keep both, add to contradictions.md for review
   * - duplicate: Discard the new fact
   */
  resolve(
    contradiction: Contradiction,
    entity: EntityDocument,
    resolution?: 'update' | 'conflict' | 'duplicate',
  ): {
    resolution: 'update' | 'conflict' | 'duplicate';
    historyEntry?: HistoryEntry;
  } {
    const classification =
      resolution ?? this.classifyContradiction(contradiction);

    // Record in DB
    this.db.saveContradiction({
      ...contradiction,
      resolved: true,
      resolution: classification,
      resolvedAt: new Date().toISOString(),
    });

    if (classification === 'update') {
      const historyEntry: HistoryEntry = {
        date: new Date().toISOString().slice(0, 10),
        description: contradiction.newFact,
        supersedes: contradiction.existingFact,
      };

      return { resolution: 'update', historyEntry };
    }

    if (classification === 'conflict') {
      // Save to contradictions.md for user review
      this.appendToContradictionsFile(contradiction, entity);
      return { resolution: 'conflict' };
    }

    // duplicate - nothing to do
    return { resolution: 'duplicate' };
  }

  /**
   * Get all unresolved contradictions.
   */
  getUnresolved(entityId?: string): Contradiction[] {
    return this.db.getUnresolvedContradictions(entityId);
  }

  /**
   * Write a contradiction to the contradictions.md file for user review.
   */
  private appendToContradictionsFile(
    contradiction: Contradiction,
    entity: EntityDocument,
  ): void {
    const storeBaseDir = path.dirname(
      path.dirname(
        path.resolve(entity.filePath),
      ),
    );
    const filePath = path.join(storeBaseDir, 'contradictions.md');

    let content = '';
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf-8');
    } else {
      content = '# Contradictions\n\nConflicting facts that need user review.\n\n';
    }

    const entry = [
      `## ${entity.frontmatter.name} — ${contradiction.detectedAt.slice(0, 10)}`,
      '',
      `**Existing**: ${contradiction.existingFact}`,
      `**New**: ${contradiction.newFact}`,
      `**ID**: ${contradiction.id}`,
      '',
      '---',
      '',
    ].join('\n');

    content += entry;
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Extract individual facts from an entity's body.
   * Facts are identified as bullet points in the body.
   */
  private extractFacts(entity: EntityDocument): string[] {
    const lines = entity.body.split('\n');
    const facts: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Bullet points are individual facts
      if (trimmed.startsWith('- ') && !trimmed.startsWith('- [')) {
        facts.push(trimmed.slice(2));
      }
    }

    return facts;
  }

  /**
   * Check if two facts are essentially the same.
   */
  private isExactDuplicate(a: string, b: string): boolean {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalize(a) === normalize(b);
  }

  /**
   * Check if two facts share a subject (first few significant words).
   */
  private hasSharedSubject(a: string, b: string): boolean {
    const getSubject = (s: string): string => {
      const words = s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 3);
      return words.join(' ');
    };

    const subjectA = getSubject(a);
    const subjectB = getSubject(b);

    if (subjectA.length === 0 || subjectB.length === 0) return false;

    return subjectA === subjectB;
  }
}
