import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetadataDB } from '../src/utils/db';
import { MemoryStore } from '../src/memory-store';
import { RetrievalEngine } from '../src/retrieval';
import { DEFAULT_CONFIG } from '../src/types';

describe('RetrievalEngine', () => {
  let tmpDir: string;
  let db: MetadataDB;
  let store: MemoryStore;
  let retrieval: RetrievalEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-test-'));
    db = new MetadataDB(path.join(tmpDir, 'test.db'));
    store = new MemoryStore(tmpDir, db, DEFAULT_CONFIG);
    retrieval = new RetrievalEngine(store, db, DEFAULT_CONFIG);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return empty results for empty store', () => {
    const results = retrieval.search({ text: 'anything' });
    expect(results).toHaveLength(0);
  });

  it('should find entities by keyword', () => {
    store.createEntity(
      'person',
      'Alice Chen',
      'Senior engineer on Project Atlas. Specializes in backend development with Python.',
      ['engineering', 'backend'],
    );
    store.createEntity(
      'person',
      'Bob Smith',
      'Product manager for Project Beta. Focuses on user research.',
      ['product', 'research'],
    );

    retrieval.buildIndex();

    const results = retrieval.search({ text: 'backend Python engineer' });
    expect(results.length).toBeGreaterThan(0);
    // Alice should rank higher due to keyword match
    expect(results[0].memoryId).toBe('alice-chen');
  });

  it('should incorporate credit scores in ranking', () => {
    store.createEntity(
      'preference',
      'TypeScript Pref',
      'User prefers TypeScript over JavaScript for all projects.',
      ['language'],
    );
    store.createEntity(
      'preference',
      'Python Pref',
      'User prefers Python for data science and scripting.',
      ['language'],
    );

    // Give TypeScript preference a high credit score
    db.upsertCreditRecord('typescript-pref', 0.95);
    db.upsertCreditRecord('python-pref', 0.3);

    retrieval.buildIndex();

    const results = retrieval.search({
      text: 'programming language preference',
    });
    expect(results.length).toBe(2);

    // TypeScript should rank higher due to credit score
    const tsResult = results.find((r) => r.memoryId === 'typescript-pref');
    const pyResult = results.find((r) => r.memoryId === 'python-pref');
    expect(tsResult).toBeDefined();
    expect(pyResult).toBeDefined();
    expect(tsResult!.creditScore).toBeGreaterThan(pyResult!.creditScore);
  });

  it('should filter by tags', () => {
    store.createEntity('preference', 'Vim Pref', 'Uses Vim', ['editor']);
    store.createEntity('preference', 'Dark Mode', 'Prefers dark mode', [
      'ui',
    ]);

    retrieval.buildIndex();

    const results = retrieval.search({
      text: 'preferences',
      tags: ['editor'],
    });

    // Should only return the editor-tagged result
    expect(results.every((r) => r.document.frontmatter.tags.includes('editor'))).toBe(true);
  });

  it('should filter by minimum credit score', () => {
    store.createEntity('preference', 'Low Value', 'Some old preference', []);
    store.createEntity(
      'preference',
      'High Value',
      'Important preference',
      [],
    );

    db.upsertCreditRecord('low-value', 0.1);
    db.upsertCreditRecord('high-value', 0.9);

    retrieval.buildIndex();

    const results = retrieval.search({
      text: 'preference',
      minCreditScore: 0.5,
    });

    expect(results.every((r) => r.creditScore >= 0.5)).toBe(true);
  });

  it('should respect maxResults limit', () => {
    for (let i = 0; i < 20; i++) {
      store.createEntity(
        'preference',
        `Pref ${i}`,
        `Preference number ${i}`,
        ['test'],
      );
    }

    retrieval.buildIndex();

    const results = retrieval.search({
      text: 'preference',
      maxResults: 5,
    });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('should retrieve within token budget', () => {
    for (let i = 0; i < 10; i++) {
      store.createEntity(
        'preference',
        `Pref ${i}`,
        'A'.repeat(200), // ~50 tokens each
        ['test'],
      );
    }

    retrieval.buildIndex();

    const results = retrieval.retrieveWithinBudget(
      { text: 'preference' },
      150, // Budget for ~3 items
    );

    // Should limit based on token budget
    expect(results.length).toBeLessThan(10);
  });

  it('should get top credit memories', () => {
    store.createEntity('preference', 'Top A', 'Important A', []);
    store.createEntity('preference', 'Top B', 'Important B', []);
    store.createEntity('preference', 'Low C', 'Not important C', []);

    db.upsertCreditRecord('top-a', 0.9);
    db.upsertCreditRecord('top-b', 0.8);
    db.upsertCreditRecord('low-c', 0.2);

    retrieval.buildIndex();

    const top = retrieval.getTopCreditMemories(2);
    expect(top.length).toBe(2);
    expect(top[0].creditScore).toBeGreaterThanOrEqual(top[1].creditScore);
  });

  it('should handle quick search', () => {
    store.createEntity(
      'person',
      'Alice',
      'Alice is a software engineer who works on databases',
      [],
    );
    store.createEntity(
      'person',
      'Bob',
      'Bob is a product designer focused on mobile apps',
      [],
    );

    retrieval.buildIndex();

    const results = retrieval.quickSearch('database engineer');
    expect(results.length).toBeGreaterThan(0);
  });
});
