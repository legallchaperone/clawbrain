import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MetadataDB } from '../src/utils/db';
import { MemoryStore } from '../src/memory-store';
import { DEFAULT_CONFIG } from '../src/types';

describe('MemoryStore', () => {
  let tmpDir: string;
  let db: MetadataDB;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memstore-test-'));
    db = new MetadataDB(path.join(tmpDir, 'test.db'));
    store = new MemoryStore(tmpDir, db, DEFAULT_CONFIG);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('entities', () => {
    it('should create and retrieve a person entity', () => {
      const entity = store.createEntity(
        'person',
        'Alice Chen',
        '- Role: Senior engineer\n- Email: alice@co.com',
        ['team', 'engineering'],
      );

      expect(entity.id).toBe('alice-chen');
      expect(entity.frontmatter.type).toBe('person');
      expect(entity.frontmatter.name).toBe('Alice Chen');
      expect(entity.frontmatter.tags).toContain('team');

      const retrieved = store.getEntity('alice-chen');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.frontmatter.name).toBe('Alice Chen');
      expect(retrieved!.body).toContain('Senior engineer');
    });

    it('should create entities for all types', () => {
      store.createEntity('person', 'Jane', 'A person', []);
      store.createEntity('project', 'Atlas', 'A project', []);
      store.createEntity('preference', 'Dark Mode', 'Prefers dark', []);

      expect(store.getEntity('jane')).not.toBeNull();
      expect(store.getEntity('atlas')).not.toBeNull();
      expect(store.getEntity('dark-mode')).not.toBeNull();
    });

    it('should throw on duplicate entity', () => {
      store.createEntity('person', 'Alice', 'First Alice', []);
      expect(() => {
        store.createEntity('person', 'Alice', 'Second Alice', []);
      }).toThrow('Entity already exists');
    });

    it('should update entity body and frontmatter', () => {
      store.createEntity('person', 'Alice', '- Role: Engineer', []);

      const updated = store.updateEntity('alice', {
        body: '- Role: Tech Lead\n- Team: Platform',
        frontmatter: { tags: ['team', 'lead'] },
        historyEntry: {
          date: '2026-02-19',
          description: 'Promoted to Tech Lead',
          supersedes: 'Engineer',
        },
      });

      expect(updated).not.toBeNull();
      expect(updated!.body).toContain('Tech Lead');
      expect(updated!.frontmatter.tags).toContain('lead');
      expect(updated!.history).toHaveLength(1);
      expect(updated!.history[0].supersedes).toBe('Engineer');
    });

    it('should archive an entity', () => {
      store.createEntity('preference', 'Old Pref', 'Outdated', []);

      const result = store.archiveEntity('old-pref');
      expect(result).toBe(true);

      // Should no longer be findable
      expect(store.getEntity('old-pref')).toBeNull();

      // Should exist in archive
      const archivePath = path.join(
        tmpDir,
        'memory-engine',
        'archive',
        'old-pref.md',
      );
      expect(fs.existsSync(archivePath)).toBe(true);
    });

    it('should not archive pinned entities', () => {
      store.createEntity('preference', 'Pinned', 'Keep me', []);
      store.updateEntity('pinned', { frontmatter: { pinned: true } });

      const result = store.archiveEntity('pinned');
      expect(result).toBe(false);
      expect(store.getEntity('pinned')).not.toBeNull();
    });

    it('should list all entities', () => {
      store.createEntity('person', 'Alice', 'A', []);
      store.createEntity('person', 'Bob', 'B', []);
      store.createEntity('project', 'Atlas', 'C', []);

      const all = store.listEntities();
      expect(all).toHaveLength(3);

      const people = store.listEntities('person');
      expect(people).toHaveLength(2);

      const projects = store.listEntities('project');
      expect(projects).toHaveLength(1);
    });

    it('should set initial credit score', () => {
      store.createEntity('preference', 'High Value', 'Important', [], 0.9);

      const record = db.getCreditRecord('high-value');
      expect(record).not.toBeNull();
      expect(record!.creditScore).toBe(0.9);
    });
  });

  describe('episodes', () => {
    it('should create and retrieve an episode', () => {
      const episode = store.createEpisode(
        'Debugging Session',
        'Spent 2 hours debugging Redis connection pool issue.',
        ['alice-chen'],
        'success',
        ['debugging', 'redis'],
      );

      expect(episode.id).toBe('debugging-session');
      expect(episode.frontmatter.type).toBe('episode');
      expect(episode.frontmatter.entities).toContain('alice-chen');
      expect(episode.frontmatter.outcome).toBe('success');

      const retrieved = store.getEpisode('debugging-session');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.body).toContain('Redis');
    });

    it('should handle duplicate episode names', () => {
      store.createEpisode('Meeting', 'First meeting', [], 'success', []);
      const second = store.createEpisode(
        'Meeting',
        'Second meeting',
        [],
        'success',
        [],
      );

      // Should have a unique slug (with UUID suffix)
      expect(second.id).not.toBe('meeting');
      expect(second.id).toMatch(/^meeting-/);
    });

    it('should list episodes with date filters', () => {
      store.createEpisode('Recent', 'Recent event', [], 'success', []);

      const all = store.listEpisodes();
      expect(all.length).toBeGreaterThanOrEqual(1);

      // With a future date filter, should get nothing
      const future = store.listEpisodes({ since: '2030-01-01' });
      expect(future).toHaveLength(0);
    });

    it('should update an episode', () => {
      store.createEpisode('Task', 'In progress', [], 'partial', []);

      const updated = store.updateEpisode('task', {
        body: 'Completed successfully',
        frontmatter: { outcome: 'success' as const },
      });

      expect(updated).not.toBeNull();
      expect(updated!.body).toBe('Completed successfully');
    });
  });

  describe('bulk operations', () => {
    it('should list all documents', () => {
      store.createEntity('person', 'Alice', 'A', []);
      store.createEpisode('Event', 'Something', [], 'success', []);

      const all = store.listAll();
      expect(all).toHaveLength(2);
    });

    it('should find by tags', () => {
      store.createEntity('person', 'Alice', 'A', ['team-a']);
      store.createEntity('person', 'Bob', 'B', ['team-b']);
      store.createEpisode('Event', 'E', [], 'success', ['team-a']);

      const teamA = store.findByTags(['team-a']);
      expect(teamA).toHaveLength(2);
    });

    it('should get active items', () => {
      store.createEntity('project', 'Active Project', 'In progress', []);
      store.updateEntity('active-project', {
        frontmatter: { status: 'active' as const },
      });

      store.createEntity('project', 'Done Project', 'Finished', []);

      const active = store.getActiveItems();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('active-project');
    });

    it('should get by ID regardless of type', () => {
      store.createEntity('person', 'Alice', 'Person', []);
      store.createEpisode('Event', 'Episode', [], 'success', []);

      expect(store.getById('alice')).not.toBeNull();
      expect(store.getById('event')).not.toBeNull();
      expect(store.getById('nonexistent')).toBeNull();
    });
  });
});
