/**
 * Markdown parsing utilities for structured memory files.
 *
 * Handles frontmatter extraction, entity/episode parsing,
 * and Markdown generation for memory documents.
 */

import matter from 'gray-matter';
import type {
  MemoryDocument,
  MemoryFrontmatter,
  EntityDocument,
  EpisodeDocument,
  HistoryEntry,
  EntityType,
  MemoryType,
} from '../types';

/**
 * Parse a Markdown file with YAML frontmatter into a MemoryDocument.
 */
export function parseMemoryDocument(
  filePath: string,
  raw: string,
): MemoryDocument {
  const { data, content } = matter(raw);
  const fm = data as Partial<MemoryFrontmatter>;

  const frontmatter: MemoryFrontmatter = {
    type: (fm.type as MemoryType) ?? 'preference',
    name: fm.name ?? slugToName(filePathToSlug(filePath)),
    created: fm.created ?? new Date().toISOString().slice(0, 10),
    updated: fm.updated ?? new Date().toISOString().slice(0, 10),
    credit_score: fm.credit_score ?? 0.5,
    tags: fm.tags ?? [],
    pinned: fm.pinned,
    status: fm.status,
    entities: fm.entities,
    outcome: fm.outcome,
  };

  return {
    id: filePathToSlug(filePath),
    filePath,
    frontmatter,
    body: content.trim(),
  };
}

/**
 * Parse a Markdown file as an EntityDocument, extracting the History section.
 */
export function parseEntityDocument(
  filePath: string,
  raw: string,
): EntityDocument {
  const doc = parseMemoryDocument(filePath, raw);
  const history = extractHistoryEntries(doc.body);

  return {
    ...doc,
    frontmatter: {
      ...doc.frontmatter,
      type: doc.frontmatter.type as EntityType,
    },
    history,
  };
}

/**
 * Parse a Markdown file as an EpisodeDocument.
 */
export function parseEpisodeDocument(
  filePath: string,
  raw: string,
): EpisodeDocument {
  const doc = parseMemoryDocument(filePath, raw);

  return {
    ...doc,
    frontmatter: {
      ...doc.frontmatter,
      type: 'episode',
      date:
        (doc.frontmatter as unknown as Record<string, unknown>).date as string ??
        doc.frontmatter.created,
      entities: doc.frontmatter.entities ?? [],
      outcome: doc.frontmatter.outcome ?? 'unknown',
    },
  };
}

/**
 * Serialize a MemoryDocument back to Markdown with frontmatter.
 */
export function serializeMemoryDocument(doc: MemoryDocument): string {
  const fm: Record<string, unknown> = { ...doc.frontmatter };

  // Remove undefined/null values
  for (const key of Object.keys(fm)) {
    if (fm[key] === undefined || fm[key] === null) {
      delete fm[key];
    }
  }

  return matter.stringify(doc.body, fm);
}

/**
 * Serialize an EntityDocument, appending history entries.
 */
export function serializeEntityDocument(doc: EntityDocument): string {
  let body = doc.body;

  // If body already has a History section, replace it
  const historyIdx = body.indexOf('## History');
  if (historyIdx >= 0) {
    body = body.slice(0, historyIdx).trimEnd();
  }

  if (doc.history.length > 0) {
    body += '\n\n## History\n';
    for (const entry of doc.history) {
      let line = `- [${entry.date}] ${entry.description}`;
      if (entry.supersedes) {
        line += ` (supersedes: "${entry.supersedes}")`;
      }
      body += line + '\n';
    }
  }

  return serializeMemoryDocument({ ...doc, body });
}

/**
 * Extract a slug from a relative file path.
 * e.g. "entities/people/alice-chen.md" -> "alice-chen"
 */
export function filePathToSlug(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.md$/, '');
}

/**
 * Convert a slug back to a human-readable name.
 * e.g. "alice-chen" -> "Alice Chen"
 */
export function slugToName(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Convert a name to a URL-safe slug.
 * e.g. "Alice Chen" -> "alice-chen"
 */
export function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract history entries from the "## History" section of a document body.
 */
function extractHistoryEntries(body: string): HistoryEntry[] {
  const historyIdx = body.indexOf('## History');
  if (historyIdx < 0) return [];

  const historySection = body.slice(historyIdx);
  const lines = historySection.split('\n').filter((l) => l.startsWith('- ['));

  return lines.map((line) => {
    const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2})\]/);
    const supersedesMatch = line.match(/\(supersedes: "(.+?)"\)/);

    let description = line.replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '');
    if (supersedesMatch) {
      description = description.replace(supersedesMatch[0], '').trim();
    }

    return {
      date: dateMatch?.[1] ?? new Date().toISOString().slice(0, 10),
      description,
      supersedes: supersedesMatch?.[1],
    };
  });
}

/**
 * Estimate the token count of a string (rough approximation: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a frontmatter object for a new entity.
 */
export function buildEntityFrontmatter(
  type: EntityType,
  name: string,
  tags: string[] = [],
): MemoryFrontmatter {
  const now = new Date().toISOString().slice(0, 10);
  return {
    type,
    name,
    created: now,
    updated: now,
    credit_score: 0.5,
    tags,
  };
}

/**
 * Build a frontmatter object for a new episode.
 */
export function buildEpisodeFrontmatter(
  name: string,
  entities: string[] = [],
  outcome: 'success' | 'failure' | 'partial' | 'unknown' = 'unknown',
  tags: string[] = [],
): MemoryFrontmatter {
  const now = new Date().toISOString().slice(0, 10);
  return {
    type: 'episode',
    name,
    created: now,
    updated: now,
    credit_score: 0.5,
    tags,
    entities,
    outcome,
  };
}
