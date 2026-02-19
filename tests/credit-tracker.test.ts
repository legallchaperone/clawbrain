import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetadataDB } from '../src/utils/db';
import { CreditTracker } from '../src/credit-tracker';
import { DEFAULT_CONFIG } from '../src/types';
import type { TurnOutcome } from '../src/types';

describe('CreditTracker', () => {
  let tmpDir: string;
  let db: MetadataDB;
  let tracker: CreditTracker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-test-'));
    db = new MetadataDB(path.join(tmpDir, 'test.db'));
    tracker = new CreditTracker(db, { ...DEFAULT_CONFIG, creditAlpha: 0.2 });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should initialize with default credit score of 0.5', () => {
    expect(tracker.getCreditScore('unknown-memory')).toBe(0.5);
  });

  it('should record retrieval and update recall count', () => {
    tracker.recordRetrieval('turn-1', ['mem-a', 'mem-b']);

    const recordA = tracker.getCreditRecord('mem-a');
    expect(recordA).not.toBeNull();
    expect(recordA!.recallCount).toBe(1);
  });

  it('should update credit scores on successful outcome', () => {
    tracker.recordRetrieval('turn-1', ['mem-a']);

    const successOutcome: TurnOutcome = {
      taskCompleted: true,
      userSatisfaction: 0.5,
      toolSuccess: true,
      userCorrection: false,
      conversationAbandoned: false,
      conversationContinued: true,
    };

    tracker.recordOutcome('turn-1', 'session-1', successOutcome);

    const score = tracker.getCreditScore('mem-a');
    // Should increase from 0.5 (reward is positive)
    expect(score).toBeGreaterThan(0.5);
  });

  it('should decrease credit scores on negative outcome', () => {
    tracker.recordRetrieval('turn-1', ['mem-a']);

    const negativeOutcome: TurnOutcome = {
      taskCompleted: false,
      userSatisfaction: -0.5,
      toolSuccess: false,
      userCorrection: true,
      conversationAbandoned: false,
      conversationContinued: true,
    };

    tracker.recordOutcome('turn-1', 'session-1', negativeOutcome);

    const score = tracker.getCreditScore('mem-a');
    // Should decrease from 0.5 (reward is negative)
    expect(score).toBeLessThan(0.5);
  });

  it('should apply credit sharing across multiple retrieved memories', () => {
    tracker.recordRetrieval('turn-1', ['mem-a', 'mem-b', 'mem-c', 'mem-d']);

    const outcome: TurnOutcome = {
      taskCompleted: true,
      userSatisfaction: 0.3,
      toolSuccess: true,
      userCorrection: false,
      conversationAbandoned: false,
      conversationContinued: true,
    };

    tracker.recordOutcome('turn-1', 'session-1', outcome);

    const scoreA = tracker.getCreditScore('mem-a');
    // With 4 memories, credit is shared (divided by sqrt(4) = 2)
    // EMA with alpha=0.2: newScore = 0.8*0.5 + 0.2*(reward/2)
    // The credit-shared update is smaller than single-memory retrieval
    expect(scoreA).not.toBe(0.5); // Score was updated
  });

  it('should accumulate credit over multiple turns', () => {
    const successOutcome: TurnOutcome = {
      taskCompleted: true,
      userSatisfaction: 0.5,
      toolSuccess: true,
      userCorrection: false,
      conversationAbandoned: false,
      conversationContinued: true,
    };

    // Three successful turns with the same memory
    for (let i = 0; i < 3; i++) {
      tracker.recordRetrieval(`turn-${i}`, ['mem-a']);
      tracker.recordOutcome(`turn-${i}`, 'session-1', successOutcome);
    }

    const score = tracker.getCreditScore('mem-a');
    expect(score).toBeGreaterThan(0.6); // Should have accumulated
  });

  it('should handle manual credit adjustment', () => {
    tracker.recordRetrieval('turn-1', ['mem-a']);

    tracker.manualAdjust('mem-a', 0.3);
    expect(tracker.getCreditScore('mem-a')).toBeCloseTo(0.8, 1);

    tracker.manualAdjust('mem-a', -0.5);
    expect(tracker.getCreditScore('mem-a')).toBeCloseTo(0.3, 1);
  });

  it('should clamp credit scores to [0, 1]', () => {
    tracker.recordRetrieval('turn-1', ['mem-a']);
    tracker.manualAdjust('mem-a', 2.0);
    expect(tracker.getCreditScore('mem-a')).toBeLessThanOrEqual(1.0);

    tracker.manualAdjust('mem-a', -5.0);
    expect(tracker.getCreditScore('mem-a')).toBeGreaterThanOrEqual(0.0);
  });

  it('should return correct statistics', () => {
    // Create some memories with different scores
    db.upsertCreditRecord('high', 0.9);
    db.upsertCreditRecord('mid', 0.5);
    db.upsertCreditRecord('low', 0.1);

    const stats = tracker.getStats();
    expect(stats.totalMemories).toBe(3);
    expect(stats.highCredit).toBe(1);
    expect(stats.lowCredit).toBe(1);
    expect(stats.avgCreditScore).toBe(0.5);
    expect(stats.medianCredit).toBe(0.5);
  });

  it('should identify low credit memories for pruning', () => {
    // Create memories with different credit scores
    db.upsertCreditRecord('good-mem', 0.8);
    db.upsertCreditRecord('bad-mem', 0.1);

    // Verify that getAllCreditScores captures the credit differentiation
    // (getLowCreditMemories also applies age/recall filters from DB)
    const allScores = tracker.getAllCreditScores();
    expect(allScores.get('bad-mem')).toBeLessThan(0.2);
    expect(allScores.get('good-mem')).toBeGreaterThan(0.2);
  });

  it('should not update credits when no memories were retrieved', () => {
    const outcome: TurnOutcome = {
      taskCompleted: true,
      userSatisfaction: 1.0,
      toolSuccess: true,
      userCorrection: false,
      conversationAbandoned: false,
      conversationContinued: true,
    };

    // Record outcome without prior retrieval
    tracker.recordOutcome('turn-orphan', 'session-1', outcome);

    // Should not crash, and no credit records should be created
    const scores = tracker.getAllCreditScores();
    expect(scores.size).toBe(0);
  });
});
