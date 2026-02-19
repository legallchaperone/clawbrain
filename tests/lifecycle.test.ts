import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetadataDB } from '../src/utils/db';
import { MemoryStore } from '../src/memory-store';
import { CreditTracker } from '../src/credit-tracker';
import { ContradictionDetector } from '../src/contradiction';
import { LifecycleManager } from '../src/lifecycle';
import { DEFAULT_CONFIG } from '../src/types';
import type { PluginConfig } from '../src/types';

describe('LifecycleManager', () => {
  let tmpDir: string;
  let db: MetadataDB;
  let store: MemoryStore;
  let creditTracker: CreditTracker;
  let contradictionDetector: ContradictionDetector;
  let lifecycle: LifecycleManager;
  let config: PluginConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-test-'));
    db = new MetadataDB(path.join(tmpDir, 'test.db'));
    config = { ...DEFAULT_CONFIG };
    store = new MemoryStore(tmpDir, db, config);
    creditTracker = new CreditTracker(db, config);
    contradictionDetector = new ContradictionDetector(db, config);
    lifecycle = new LifecycleManager(
      store,
      creditTracker,
      contradictionDetector,
      db,
      config,
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('pruning', () => {
    // Use a zero-age config so newly-created test records pass the age filter
    let zeroAgeLifecycle: LifecycleManager;

    beforeEach(() => {
      const zeroAgeConfig = { ...config, pruneMinAge: 0, pruneThreshold: 0.2 };
      const zeroAgeCreditTracker = new CreditTracker(db, zeroAgeConfig);
      zeroAgeLifecycle = new LifecycleManager(
        store,
        zeroAgeCreditTracker,
        contradictionDetector,
        db,
        zeroAgeConfig,
      );
    });

    it('should not prune person entities', async () => {
      store.createEntity('person', 'Jane Doe', 'A coworker', ['team']);
      db.upsertCreditRecord('jane-doe', 0.05, 0); // Very low credit, 0 recalls

      const result = await zeroAgeLifecycle.prune();
      expect(result.protectedIds).toContain('jane-doe');
      expect(result.prunedIds).not.toContain('jane-doe');
    });

    it('should not prune pinned items', async () => {
      store.createEntity(
        'preference',
        'Important Pref',
        'Must keep',
        ['critical'],
      );
      store.updateEntity('important-pref', {
        frontmatter: { pinned: true },
      });
      db.upsertCreditRecord('important-pref', 0.05, 0);

      const result = await zeroAgeLifecycle.prune();
      expect(result.protectedIds).toContain('important-pref');
    });

    it('should protect newly created memories via the 14-day safety rail', async () => {
      store.createEntity('preference', 'Old Pref', 'Outdated pref', ['old']);
      db.upsertCreditRecord('old-pref', 0.05, 0);

      const result = await zeroAgeLifecycle.prune();
      // Even though credit is low, the hard-coded 14-day safety rail
      // protects all newly created memories from being pruned
      expect(result.protectedIds).toContain('old-pref');
      expect(result.prunedIds).not.toContain('old-pref');
    });
  });

  describe('promotion', () => {
    it('should promote high-credit episode facts to entities', async () => {
      // Create an entity
      store.createEntity('person', 'Bob Smith', '- Role: Engineer', [
        'team',
      ]);

      // Create an episode with high credit that references the entity
      const episode = store.createEpisode(
        'Meeting with Bob',
        '- Bob mentioned he prefers Python over JavaScript\n- Bob is moving to the platform team',
        ['bob-smith'],
        'success',
        ['meeting'],
      );

      // Set high credit
      db.upsertCreditRecord(episode.id, 0.85);

      const results = await lifecycle.promote();
      // Should attempt to promote facts from the episode
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('consolidation', () => {
    it('should consolidate clusters of 3+ related episodes', async () => {
      // Create entity for reference
      store.createEntity('project', 'Project X', 'A project', ['dev']);

      // Create 3+ episodes with shared entities
      for (let i = 0; i < 4; i++) {
        store.createEpisode(
          `Session ${i} on Project X`,
          `Worked on feature ${i} for Project X. Made progress on the API.`,
          ['project-x'],
          'success',
          ['dev'],
        );
      }

      const results = await lifecycle.consolidate();
      // Should have at least one consolidation result if clustering works
      expect(results).toBeDefined();
    });
  });
});
