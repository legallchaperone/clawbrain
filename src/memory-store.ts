/**
 * Structured Memory Store
 *
 * Manages CRUD operations for three memory types:
 * - Semantic (entities): durable facts about people, projects, preferences
 * - Episodic: summaries of significant interactions
 * - Working: active tasks and open loops
 *
 * All memories are stored as Markdown files with YAML frontmatter,
 * with metadata indexed in SQLite for fast querying.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  MemoryDocument,
  EntityDocument,
  EpisodeDocument,
  EntityType,
  MemoryFrontmatter,
  HistoryEntry,
  PluginConfig,
} from './types';
import {
  parseMemoryDocument,
  parseEntityDocument,
  parseEpisodeDocument,
  serializeMemoryDocument,
  serializeEntityDocument,
  nameToSlug,
  buildEntityFrontmatter,
  buildEpisodeFrontmatter,
} from './utils/markdown-parser';
import { MetadataDB } from './utils/db';

const TYPE_TO_DIR: Record<EntityType, string> = {
  person: 'people',
  project: 'projects',
  preference: 'preferences',
};

export class MemoryStore {
  private baseDir: string;
  private db: MetadataDB;
  private config: PluginConfig;

  constructor(workspaceDir: string, db: MetadataDB, config: PluginConfig) {
    this.baseDir = path.join(workspaceDir, 'memory-engine');
    this.db = db;
    this.config = config;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      path.join(this.baseDir, 'entities', 'people'),
      path.join(this.baseDir, 'entities', 'projects'),
      path.join(this.baseDir, 'entities', 'preferences'),
      path.join(this.baseDir, 'episodes'),
      path.join(this.baseDir, 'archive'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  // --- Entity CRUD ---

  /**
   * Create a new entity document.
   */
  createEntity(
    type: EntityType,
    name: string,
    body: string,
    tags: string[] = [],
    initialCreditScore?: number,
  ): EntityDocument {
    const slug = nameToSlug(name);
    const dirName = TYPE_TO_DIR[type];
    const relPath = `entities/${dirName}/${slug}.md`;
    const absPath = path.join(this.baseDir, relPath);

    if (fs.existsSync(absPath)) {
      throw new Error(`Entity already exists: ${relPath}`);
    }

    const frontmatter = buildEntityFrontmatter(type, name, tags);
    if (initialCreditScore !== undefined) {
      frontmatter.credit_score = initialCreditScore;
    }

    const doc: EntityDocument = {
      id: slug,
      filePath: relPath,
      frontmatter: { ...frontmatter, type } as EntityDocument['frontmatter'],
      body,
      history: [],
    };

    fs.writeFileSync(absPath, serializeEntityDocument(doc), 'utf-8');
    this.db.upsertCreditRecord(slug, frontmatter.credit_score);

    return doc;
  }

  /**
   * Read an entity by slug.
   */
  getEntity(slug: string): EntityDocument | null {
    for (const type of ['people', 'projects', 'preferences'] as const) {
      const relPath = `entities/${type}/${slug}.md`;
      const absPath = path.join(this.baseDir, relPath);
      if (fs.existsSync(absPath)) {
        const raw = fs.readFileSync(absPath, 'utf-8');
        return parseEntityDocument(relPath, raw);
      }
    }
    return null;
  }

  /**
   * Update an entity's body and/or frontmatter.
   */
  updateEntity(
    slug: string,
    updates: {
      body?: string;
      frontmatter?: Partial<MemoryFrontmatter>;
      historyEntry?: HistoryEntry;
    },
  ): EntityDocument | null {
    const existing = this.getEntity(slug);
    if (!existing) return null;

    if (updates.body !== undefined) {
      existing.body = updates.body;
    }
    if (updates.frontmatter) {
      Object.assign(existing.frontmatter, updates.frontmatter);
      existing.frontmatter.updated = new Date().toISOString().slice(0, 10);
    }
    if (updates.historyEntry) {
      existing.history.push(updates.historyEntry);
    }

    const absPath = path.join(this.baseDir, existing.filePath);
    fs.writeFileSync(absPath, serializeEntityDocument(existing), 'utf-8');

    if (updates.frontmatter?.credit_score !== undefined) {
      this.db.updateCreditScore(slug, updates.frontmatter.credit_score);
    }

    return existing;
  }

  /**
   * Delete (archive) an entity.
   */
  archiveEntity(slug: string): boolean {
    const entity = this.getEntity(slug);
    if (!entity) return false;

    // Check protection
    if (entity.frontmatter.pinned) return false;

    const srcPath = path.join(this.baseDir, entity.filePath);
    const destPath = path.join(this.baseDir, 'archive', `${slug}.md`);

    fs.renameSync(srcPath, destPath);
    return true;
  }

  // --- Episode CRUD ---

  /**
   * Create a new episode document.
   */
  createEpisode(
    name: string,
    body: string,
    entities: string[] = [],
    outcome: 'success' | 'failure' | 'partial' | 'unknown' = 'unknown',
    tags: string[] = [],
  ): EpisodeDocument {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const slug = nameToSlug(name);
    const dirPath = path.join(this.baseDir, 'episodes', yearMonth);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const relPath = `episodes/${yearMonth}/${slug}.md`;
    const absPath = path.join(this.baseDir, relPath);

    // Handle name collision
    let finalPath = absPath;
    let finalRelPath = relPath;
    let finalSlug = slug;
    if (fs.existsSync(absPath)) {
      const suffix = uuidv4().slice(0, 8);
      finalSlug = `${slug}-${suffix}`;
      finalRelPath = `episodes/${yearMonth}/${finalSlug}.md`;
      finalPath = path.join(this.baseDir, finalRelPath);
    }

    const frontmatter = buildEpisodeFrontmatter(name, entities, outcome, tags);

    const doc: EpisodeDocument = {
      id: finalSlug,
      filePath: finalRelPath,
      frontmatter: {
        ...frontmatter,
        type: 'episode',
        date: now.toISOString().slice(0, 10),
        entities,
        outcome,
      },
      body,
    };

    fs.writeFileSync(finalPath, serializeMemoryDocument(doc), 'utf-8');
    this.db.upsertCreditRecord(finalSlug, frontmatter.credit_score);

    return doc;
  }

  /**
   * Read an episode by slug. Searches recent months.
   */
  getEpisode(slug: string): EpisodeDocument | null {
    const episodesDir = path.join(this.baseDir, 'episodes');
    if (!fs.existsSync(episodesDir)) return null;

    const months = fs
      .readdirSync(episodesDir)
      .filter((d) => /^\d{4}-\d{2}$/.test(d))
      .sort()
      .reverse();

    for (const month of months) {
      const relPath = `episodes/${month}/${slug}.md`;
      const absPath = path.join(this.baseDir, relPath);
      if (fs.existsSync(absPath)) {
        const raw = fs.readFileSync(absPath, 'utf-8');
        return parseEpisodeDocument(relPath, raw);
      }
    }
    return null;
  }

  /**
   * Update an episode.
   */
  updateEpisode(
    slug: string,
    updates: {
      body?: string;
      frontmatter?: Partial<MemoryFrontmatter>;
    },
  ): EpisodeDocument | null {
    const existing = this.getEpisode(slug);
    if (!existing) return null;

    if (updates.body !== undefined) {
      existing.body = updates.body;
    }
    if (updates.frontmatter) {
      Object.assign(existing.frontmatter, updates.frontmatter);
      existing.frontmatter.updated = new Date().toISOString().slice(0, 10);
    }

    const absPath = path.join(this.baseDir, existing.filePath);
    fs.writeFileSync(absPath, serializeMemoryDocument(existing), 'utf-8');

    if (updates.frontmatter?.credit_score !== undefined) {
      this.db.updateCreditScore(slug, updates.frontmatter.credit_score);
    }

    return existing;
  }

  /**
   * Archive an episode.
   */
  archiveEpisode(slug: string): boolean {
    const episode = this.getEpisode(slug);
    if (!episode) return false;
    if (episode.frontmatter.pinned) return false;

    const srcPath = path.join(this.baseDir, episode.filePath);
    const destPath = path.join(this.baseDir, 'archive', `${slug}.md`);

    fs.renameSync(srcPath, destPath);
    return true;
  }

  // --- Bulk queries ---

  /**
   * List all entities of a given type.
   */
  listEntities(type?: EntityType): EntityDocument[] {
    const types = type
      ? [type]
      : (['person', 'project', 'preference'] as EntityType[]);

    const results: EntityDocument[] = [];

    for (const t of types) {
      const dirName = TYPE_TO_DIR[t];
      const dirPath = path.join(this.baseDir, 'entities', dirName);
      if (!fs.existsSync(dirPath)) continue;

      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const relPath = `entities/${dirName}/${file}`;
        const absPath = path.join(dirPath, file);
        const raw = fs.readFileSync(absPath, 'utf-8');
        results.push(parseEntityDocument(relPath, raw));
      }
    }

    return results;
  }

  /**
   * List episodes, optionally filtered by date range.
   */
  listEpisodes(options?: {
    since?: string;
    until?: string;
    entitySlug?: string;
  }): EpisodeDocument[] {
    const episodesDir = path.join(this.baseDir, 'episodes');
    if (!fs.existsSync(episodesDir)) return [];

    const months = fs
      .readdirSync(episodesDir)
      .filter((d) => /^\d{4}-\d{2}$/.test(d))
      .sort()
      .reverse();

    const results: EpisodeDocument[] = [];

    for (const month of months) {
      const monthDir = path.join(episodesDir, month);
      const files = fs
        .readdirSync(monthDir)
        .filter((f) => f.endsWith('.md'));

      for (const file of files) {
        const relPath = `episodes/${month}/${file}`;
        const absPath = path.join(monthDir, file);
        const raw = fs.readFileSync(absPath, 'utf-8');
        const episode = parseEpisodeDocument(relPath, raw);

        // Apply date filters
        if (options?.since && episode.frontmatter.date < options.since) continue;
        if (options?.until && episode.frontmatter.date > options.until) continue;
        if (
          options?.entitySlug &&
          !episode.frontmatter.entities.includes(options.entitySlug)
        ) {
          continue;
        }

        results.push(episode);
      }
    }

    return results;
  }

  /**
   * List all memory documents (entities + episodes).
   */
  listAll(): MemoryDocument[] {
    const entities = this.listEntities();
    const episodes = this.listEpisodes();
    return [...entities, ...episodes];
  }

  /**
   * Get all documents that match the given tags.
   */
  findByTags(tags: string[]): MemoryDocument[] {
    return this.listAll().filter((doc) =>
      tags.some((tag) => doc.frontmatter.tags.includes(tag)),
    );
  }

  /**
   * Get documents with active status (working memory).
   */
  getActiveItems(): MemoryDocument[] {
    return this.listAll().filter(
      (doc) => doc.frontmatter.status === 'active',
    );
  }

  /**
   * Get the base directory for the memory store.
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Get memory document by its ID (slug), regardless of type.
   */
  getById(id: string): MemoryDocument | null {
    const entity = this.getEntity(id);
    if (entity) return entity;

    const episode = this.getEpisode(id);
    if (episode) return episode;

    return null;
  }
}
