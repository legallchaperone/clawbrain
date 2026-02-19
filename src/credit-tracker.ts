/**
 * Credit Tracker
 *
 * Implements temporal-difference-style credit assignment for memories.
 * Tracks which memories were retrieved before successful/failed task
 * completions, and uses this signal to update credit scores over time.
 *
 * The core insight: we don't just count how often a memory was accessed,
 * but how often accessing it preceded a good outcome.
 */

import type {
  TurnOutcome,
  TurnRecord,
  CreditRecord,
  PluginConfig,
} from './types';
import { MetadataDB } from './utils/db';
import { computeReward } from './utils/outcome-signals';

export class CreditTracker {
  private db: MetadataDB;
  private config: PluginConfig;

  /** Memories retrieved in the current turn (not yet scored). */
  private pendingRetrievals: Map<string, string[]> = new Map();

  constructor(db: MetadataDB, config: PluginConfig) {
    this.db = db;
    this.config = config;
  }

  /**
   * Record that memories were retrieved for a given turn.
   * Called by the interceptor during pre-turn injection.
   */
  recordRetrieval(turnId: string, memoryIds: string[]): void {
    this.pendingRetrievals.set(turnId, memoryIds);

    // Update recall counts
    for (const memoryId of memoryIds) {
      this.ensureCreditRecord(memoryId);
      this.db.recordRecall(memoryId);
    }
  }

  /**
   * Record the outcome of a turn and update credit scores
   * for all memories that were retrieved during that turn.
   */
  recordOutcome(turnId: string, sessionId: string, outcome: TurnOutcome): void {
    const retrievedMemories = this.pendingRetrievals.get(turnId) ?? [];
    this.pendingRetrievals.delete(turnId);

    // Save the turn record
    const turnRecord: TurnRecord = {
      turnId,
      sessionId,
      timestamp: new Date().toISOString(),
      memoriesRetrieved: retrievedMemories,
      outcome,
    };
    this.db.saveTurnRecord(turnRecord);

    // Skip credit update if no memories were retrieved
    if (retrievedMemories.length === 0) return;

    // Compute scalar reward
    const reward = computeReward(outcome);

    // Update credit scores with credit sharing
    this.updateCredits(retrievedMemories, reward, outcome);
  }

  /**
   * Core credit assignment algorithm.
   *
   * Uses exponential moving average (EMA) with credit sharing:
   * - Each memory gets reward / sqrt(n) where n = number of co-retrieved memories
   * - EMA smooths out noisy individual outcomes
   */
  private updateCredits(
    memoryIds: string[],
    reward: number,
    outcome: TurnOutcome,
  ): void {
    const n = memoryIds.length;
    const alpha = this.config.creditAlpha;

    for (const memoryId of memoryIds) {
      // Credit sharing: divide reward by sqrt(n) to avoid
      // over-penalizing in multi-memory retrievals
      const delta = reward / Math.sqrt(n);

      // Get current credit score
      const record = this.db.getCreditRecord(memoryId);
      const currentScore = record?.creditScore ?? 0.5;

      // EMA update
      const newScore = (1 - alpha) * currentScore + alpha * delta;

      // Clamp to [0, 1]
      const clampedScore = Math.max(0, Math.min(1, newScore));

      // Update in DB
      this.db.updateCreditScore(memoryId, clampedScore);

      // Record the event for history/analysis
      const coRetrieved = memoryIds.filter((id) => id !== memoryId);
      this.db.addCreditEvent(memoryId, delta, outcome, coRetrieved);
    }
  }

  /**
   * Ensure a credit record exists for a memory ID.
   */
  private ensureCreditRecord(memoryId: string): void {
    const existing = this.db.getCreditRecord(memoryId);
    if (!existing) {
      this.db.upsertCreditRecord(memoryId, 0.5); // Default score
    }
  }

  /**
   * Get the credit score for a memory.
   */
  getCreditScore(memoryId: string): number {
    const record = this.db.getCreditRecord(memoryId);
    return record?.creditScore ?? 0.5;
  }

  /**
   * Get the full credit record for a memory.
   */
  getCreditRecord(memoryId: string): CreditRecord | null {
    return this.db.getCreditRecord(memoryId);
  }

  /**
   * Get all credit scores as a map.
   */
  getAllCreditScores(): Map<string, number> {
    return this.db.getAllCreditScores();
  }

  /**
   * Get memories with low credit scores that are candidates for pruning.
   */
  getLowCreditMemories(
    threshold?: number,
    minAgeDays?: number,
    maxRecallCount?: number,
  ): string[] {
    return this.db.getLowCreditMemories(
      threshold ?? this.config.pruneThreshold,
      minAgeDays ?? this.config.pruneMinAge,
      maxRecallCount ?? 3,
    );
  }

  /**
   * Manually boost or penalize a memory's credit score.
   * Useful for user-driven corrections.
   */
  manualAdjust(memoryId: string, adjustment: number): void {
    const record = this.db.getCreditRecord(memoryId);
    const currentScore = record?.creditScore ?? 0.5;
    const newScore = Math.max(0, Math.min(1, currentScore + adjustment));
    this.db.updateCreditScore(memoryId, newScore);
  }

  /**
   * Get summary statistics for credit scores.
   */
  getStats(): {
    totalMemories: number;
    avgCreditScore: number;
    highCredit: number;
    lowCredit: number;
    medianCredit: number;
  } {
    const scores = this.db.getAllCreditScores();
    const values = Array.from(scores.values());

    if (values.length === 0) {
      return {
        totalMemories: 0,
        avgCreditScore: 0,
        highCredit: 0,
        lowCredit: 0,
        medianCredit: 0,
      };
    }

    values.sort((a, b) => a - b);

    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const high = values.filter((v) => v >= 0.7).length;
    const low = values.filter((v) => v < 0.3).length;
    const median =
      values.length % 2 === 0
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        : values[Math.floor(values.length / 2)];

    return {
      totalMemories: values.length,
      avgCreditScore: Math.round(avg * 1000) / 1000,
      highCredit: high,
      lowCredit: low,
      medianCredit: Math.round(median * 1000) / 1000,
    };
  }
}
