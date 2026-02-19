/**
 * SQLite wrapper for memory-engine metadata storage.
 *
 * Stores credit histories, turn records, and search metadata
 * that don't belong in the Markdown files themselves.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import type {
  CreditRecord,
  CreditEvent,
  TurnRecord,
  TurnOutcome,
  Contradiction,
} from '../types';

export class MetadataDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credit_records (
        memory_id TEXT PRIMARY KEY,
        credit_score REAL NOT NULL DEFAULT 0.5,
        recall_count INTEGER NOT NULL DEFAULT 0,
        last_recalled TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS credit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        delta REAL NOT NULL,
        outcome_json TEXT NOT NULL,
        co_retrieved_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (memory_id) REFERENCES credit_records(memory_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS turn_records (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        memories_retrieved_json TEXT NOT NULL DEFAULT '[]',
        outcome_json TEXT
      );

      CREATE TABLE IF NOT EXISTS contradictions (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        existing_fact TEXT NOT NULL,
        new_fact TEXT NOT NULL,
        detected_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved INTEGER NOT NULL DEFAULT 0,
        resolution TEXT,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS lifecycle_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        details_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_credit_events_memory
        ON credit_events(memory_id);
      CREATE INDEX IF NOT EXISTS idx_turn_records_session
        ON turn_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_contradictions_entity
        ON contradictions(entity_id);
    `);
  }

  // --- Credit Records ---

  getCreditRecord(memoryId: string): CreditRecord | null {
    const row = this.db
      .prepare('SELECT * FROM credit_records WHERE memory_id = ?')
      .get(memoryId) as CreditRecordRow | undefined;
    if (!row) return null;

    const events = this.getCreditEvents(memoryId);
    return {
      memoryId: row.memory_id,
      creditScore: row.credit_score,
      recallCount: row.recall_count,
      lastRecalled: row.last_recalled,
      history: events,
    };
  }

  upsertCreditRecord(
    memoryId: string,
    creditScore: number,
    recallCount?: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO credit_records (memory_id, credit_score, recall_count, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(memory_id) DO UPDATE SET
           credit_score = excluded.credit_score,
           recall_count = COALESCE(?, credit_records.recall_count),
           updated_at = datetime('now')`,
      )
      .run(memoryId, creditScore, recallCount ?? 0, recallCount ?? null);
  }

  recordRecall(memoryId: string): void {
    this.db
      .prepare(
        `UPDATE credit_records
         SET recall_count = recall_count + 1,
             last_recalled = datetime('now'),
             updated_at = datetime('now')
         WHERE memory_id = ?`,
      )
      .run(memoryId);
  }

  updateCreditScore(memoryId: string, newScore: number): void {
    this.db
      .prepare(
        `UPDATE credit_records
         SET credit_score = ?, updated_at = datetime('now')
         WHERE memory_id = ?`,
      )
      .run(newScore, memoryId);
  }

  private getCreditEvents(memoryId: string): CreditEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM credit_events WHERE memory_id = ? ORDER BY timestamp DESC LIMIT 100',
      )
      .all(memoryId) as CreditEventRow[];

    return rows.map((row) => ({
      timestamp: row.timestamp,
      delta: row.delta,
      outcome: JSON.parse(row.outcome_json) as TurnOutcome,
      coRetrieved: JSON.parse(row.co_retrieved_json) as string[],
    }));
  }

  addCreditEvent(
    memoryId: string,
    delta: number,
    outcome: TurnOutcome,
    coRetrieved: string[],
  ): void {
    this.db
      .prepare(
        `INSERT INTO credit_events (memory_id, delta, outcome_json, co_retrieved_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        memoryId,
        delta,
        JSON.stringify(outcome),
        JSON.stringify(coRetrieved),
      );
  }

  // --- Turn Records ---

  saveTurnRecord(record: TurnRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO turn_records
         (turn_id, session_id, timestamp, memories_retrieved_json, outcome_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.turnId,
        record.sessionId,
        record.timestamp,
        JSON.stringify(record.memoriesRetrieved),
        record.outcome ? JSON.stringify(record.outcome) : null,
      );
  }

  getTurnRecord(turnId: string): TurnRecord | null {
    const row = this.db
      .prepare('SELECT * FROM turn_records WHERE turn_id = ?')
      .get(turnId) as TurnRecordRow | undefined;
    if (!row) return null;

    return {
      turnId: row.turn_id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      memoriesRetrieved: JSON.parse(row.memories_retrieved_json) as string[],
      outcome: row.outcome_json
        ? (JSON.parse(row.outcome_json) as TurnOutcome)
        : null,
    };
  }

  updateTurnOutcome(turnId: string, outcome: TurnOutcome): void {
    this.db
      .prepare('UPDATE turn_records SET outcome_json = ? WHERE turn_id = ?')
      .run(JSON.stringify(outcome), turnId);
  }

  getRecentTurns(sessionId: string, limit: number = 20): TurnRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM turn_records
         WHERE session_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as TurnRecordRow[];

    return rows.map((row) => ({
      turnId: row.turn_id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      memoriesRetrieved: JSON.parse(row.memories_retrieved_json) as string[],
      outcome: row.outcome_json
        ? (JSON.parse(row.outcome_json) as TurnOutcome)
        : null,
    }));
  }

  // --- Contradictions ---

  saveContradiction(contradiction: Contradiction): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO contradictions
         (id, entity_id, existing_fact, new_fact, detected_at, resolved, resolution, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        contradiction.id,
        contradiction.entityId,
        contradiction.existingFact,
        contradiction.newFact,
        contradiction.detectedAt,
        contradiction.resolved ? 1 : 0,
        contradiction.resolution ?? null,
        contradiction.resolvedAt ?? null,
      );
  }

  getUnresolvedContradictions(entityId?: string): Contradiction[] {
    let query = 'SELECT * FROM contradictions WHERE resolved = 0';
    const params: unknown[] = [];
    if (entityId) {
      query += ' AND entity_id = ?';
      params.push(entityId);
    }
    query += ' ORDER BY detected_at DESC';

    const rows = this.db.prepare(query).all(...params) as ContradictionRow[];
    return rows.map(rowToContradiction);
  }

  resolveContradiction(
    id: string,
    resolution: 'update' | 'conflict' | 'duplicate',
  ): void {
    this.db
      .prepare(
        `UPDATE contradictions
         SET resolved = 1, resolution = ?, resolved_at = datetime('now')
         WHERE id = ?`,
      )
      .run(resolution, id);
  }

  // --- Lifecycle Log ---

  logLifecycleAction(
    action: string,
    details: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        'INSERT INTO lifecycle_log (action, details_json) VALUES (?, ?)',
      )
      .run(action, JSON.stringify(details));
  }

  getLastLifecycleAction(action: string): string | null {
    const row = this.db
      .prepare(
        `SELECT timestamp FROM lifecycle_log
         WHERE action = ?
         ORDER BY timestamp DESC
         LIMIT 1`,
      )
      .get(action) as { timestamp: string } | undefined;
    return row?.timestamp ?? null;
  }

  // --- Bulk Queries ---

  getAllCreditScores(): Map<string, number> {
    const rows = this.db
      .prepare('SELECT memory_id, credit_score FROM credit_records')
      .all() as { memory_id: string; credit_score: number }[];

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.memory_id, row.credit_score);
    }
    return map;
  }

  getLowCreditMemories(
    threshold: number,
    minAgeDays: number,
    maxRecallCount: number,
  ): string[] {
    // Skip age filter when minAgeDays is 0 to avoid same-second comparison issues
    const sql =
      minAgeDays > 0
        ? `SELECT memory_id FROM credit_records
           WHERE credit_score < ?
             AND recall_count < ?
             AND created_at <= datetime('now', ? || ' days')`
        : `SELECT memory_id FROM credit_records
           WHERE credit_score < ?
             AND recall_count < ?`;

    const params: unknown[] =
      minAgeDays > 0
        ? [threshold, maxRecallCount, `-${minAgeDays}`]
        : [threshold, maxRecallCount];

    const rows = this.db.prepare(sql).all(...params) as {
      memory_id: string;
    }[];

    return rows.map((r) => r.memory_id);
  }

  close(): void {
    this.db.close();
  }
}

// --- Internal row types ---

interface CreditRecordRow {
  memory_id: string;
  credit_score: number;
  recall_count: number;
  last_recalled: string | null;
  created_at: string;
  updated_at: string;
}

interface CreditEventRow {
  id: number;
  memory_id: string;
  timestamp: string;
  delta: number;
  outcome_json: string;
  co_retrieved_json: string;
}

interface TurnRecordRow {
  turn_id: string;
  session_id: string;
  timestamp: string;
  memories_retrieved_json: string;
  outcome_json: string | null;
}

interface ContradictionRow {
  id: string;
  entity_id: string;
  existing_fact: string;
  new_fact: string;
  detected_at: string;
  resolved: number;
  resolution: string | null;
  resolved_at: string | null;
}

function rowToContradiction(row: ContradictionRow): Contradiction {
  return {
    id: row.id,
    entityId: row.entity_id,
    existingFact: row.existing_fact,
    newFact: row.new_fact,
    detectedAt: row.detected_at,
    resolved: row.resolved === 1,
    resolution: row.resolution as Contradiction['resolution'],
    resolvedAt: row.resolved_at ?? undefined,
  };
}
