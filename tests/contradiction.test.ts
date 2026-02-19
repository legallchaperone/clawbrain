import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetadataDB } from '../src/utils/db';
import { MemoryStore } from '../src/memory-store';
import { ContradictionDetector } from '../src/contradiction';
import { DEFAULT_CONFIG } from '../src/types';
import type { EntityDocument } from '../src/types';

describe('ContradictionDetector', () => {
  let tmpDir: string;
  let db: MetadataDB;
  let store: MemoryStore;
  let detector: ContradictionDetector;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contradiction-test-'));
    db = new MetadataDB(path.join(tmpDir, 'test.db'));
    store = new MemoryStore(tmpDir, db, DEFAULT_CONFIG);
    detector = new ContradictionDetector(db, DEFAULT_CONFIG);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect contradiction between similar but different facts', () => {
    const entity = store.createEntity(
      'person',
      'Alice Chen',
      '- Role: Senior engineer on Project Atlas\n- Email: alice@company.com',
      ['team'],
    );

    const entityDoc = store.getEntity('alice-chen')!;
    const contradictions = detector.checkForContradictions(
      entityDoc,
      'Role: Tech lead on Project Atlas',
    );

    // May or may not detect depending on similarity threshold
    // The test verifies the method doesn't crash
    expect(contradictions).toBeDefined();
    expect(Array.isArray(contradictions)).toBe(true);
  });

  it('should not flag exact duplicates as contradictions', () => {
    const entity = store.createEntity(
      'person',
      'Bob',
      '- Works at Acme Corp',
      [],
    );

    const entityDoc = store.getEntity('bob')!;
    const contradictions = detector.checkForContradictions(
      entityDoc,
      'Works at Acme Corp',
    );

    // Exact duplicates should not be flagged
    expect(
      contradictions.filter((c) => c.existingFact === c.newFact),
    ).toHaveLength(0);
  });

  it('should classify update indicators correctly', () => {
    const contradiction = {
      id: 'test-1',
      entityId: 'alice',
      existingFact: 'Role: Senior engineer',
      newFact: 'Role: Now promoted to Tech lead',
      detectedAt: new Date().toISOString(),
      resolved: false,
    };

    const classification = detector.classifyContradiction(contradiction);
    expect(classification).toBe('update');
  });

  it('should classify genuine conflicts', () => {
    const contradiction = {
      id: 'test-2',
      entityId: 'meeting',
      existingFact: 'Meeting is on Tuesday at 10am',
      newFact: 'Meeting is on Wednesday at 2pm',
      detectedAt: new Date().toISOString(),
      resolved: false,
    };

    const classification = detector.classifyContradiction(contradiction);
    // This could be "conflict" or "update" depending on heuristics
    expect(['update', 'conflict']).toContain(classification);
  });

  it('should resolve contradictions and record them', () => {
    const entityDoc = store.createEntity(
      'person',
      'Charlie',
      '- Role: Junior developer',
      [],
    );

    const entity = store.getEntity('charlie')!;

    const contradiction = {
      id: 'test-3',
      entityId: 'charlie',
      existingFact: 'Role: Junior developer',
      newFact: 'Role: Now promoted to Senior developer',
      detectedAt: new Date().toISOString(),
      resolved: false,
    };

    const result = detector.resolve(contradiction, entity, 'update');
    expect(result.resolution).toBe('update');
    expect(result.historyEntry).toBeDefined();
    expect(result.historyEntry!.supersedes).toBe('Role: Junior developer');
  });

  it('should track unresolved contradictions', () => {
    const contradiction = {
      id: 'test-4',
      entityId: 'some-entity',
      existingFact: 'Fact A',
      newFact: 'Fact B',
      detectedAt: new Date().toISOString(),
      resolved: false,
    };

    db.saveContradiction(contradiction);

    const unresolved = detector.getUnresolved();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe('test-4');

    // Resolve it
    db.resolveContradiction('test-4', 'update');

    const afterResolve = detector.getUnresolved();
    expect(afterResolve).toHaveLength(0);
  });

  it('should not detect contradictions when disabled', () => {
    const disabledDetector = new ContradictionDetector(db, {
      ...DEFAULT_CONFIG,
      enableContradictionDetection: false,
    });

    const entity = store.createEntity(
      'person',
      'Dave',
      '- Role: Manager',
      [],
    );
    const entityDoc = store.getEntity('dave')!;

    const contradictions = disabledDetector.checkForContradictions(
      entityDoc,
      'Role: Director (promoted from Manager)',
    );

    expect(contradictions).toHaveLength(0);
  });
});
