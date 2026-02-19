/**
 * MEMORY.md Generator
 *
 * Dynamically generates the always-loaded MEMORY.md file at each
 * session start. Replaces the static, manually maintained file with
 * a context-aware summary drawn from the structured memory store.
 *
 * Sections:
 * - Current Tasks: active items from working memory
 * - Recent Context: episodes from the last 48-72 hours
 * - Key Facts: top entities by credit score
 * - Open Loops: items awaiting external input
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PluginConfig, MemoryDocument } from './types';
import { MemoryStore } from './memory-store';
import { RetrievalEngine } from './retrieval';
import { estimateTokens } from './utils/markdown-parser';

/** Maximum token budget for the generated MEMORY.md. */
const MAX_MEMORY_TOKENS = 2000;

/** Number of top-credit entities to include. */
const TOP_ENTITIES_COUNT = 10;

/** How far back to look for recent episodes (hours). */
const RECENT_WINDOW_HOURS = 72;

export class MemoryGenerator {
  private store: MemoryStore;
  private retrieval: RetrievalEngine;
  private config: PluginConfig;
  private workspaceDir: string;

  constructor(
    store: MemoryStore,
    retrieval: RetrievalEngine,
    config: PluginConfig,
    workspaceDir: string,
  ) {
    this.store = store;
    this.retrieval = retrieval;
    this.config = config;
    this.workspaceDir = workspaceDir;
  }

  /**
   * Generate and write MEMORY.md to the workspace directory.
   */
  generate(): string {
    const sections: string[] = [];

    sections.push('# Active Context\n');

    // Section 1: Current Tasks
    const activeTasks = this.generateActiveTasksSection();
    if (activeTasks) sections.push(activeTasks);

    // Section 2: Recent Context
    const recentContext = this.generateRecentContextSection();
    if (recentContext) sections.push(recentContext);

    // Section 3: Key Facts (top credit scores)
    const keyFacts = this.generateKeyFactsSection();
    if (keyFacts) sections.push(keyFacts);

    // Section 4: Open Loops
    const openLoops = this.generateOpenLoopsSection();
    if (openLoops) sections.push(openLoops);

    let content = sections.join('\n');

    // Trim to fit token budget
    if (estimateTokens(content) > MAX_MEMORY_TOKENS) {
      content = this.trimToFit(content, MAX_MEMORY_TOKENS);
    }

    // Write to workspace
    const memoryPath = path.join(this.workspaceDir, 'MEMORY.md');
    fs.writeFileSync(memoryPath, content, 'utf-8');

    return content;
  }

  /**
   * Generate the "Current Tasks" section from active items.
   */
  private generateActiveTasksSection(): string | null {
    const activeItems = this.store.getActiveItems();

    if (activeItems.length === 0) return null;

    const lines: string[] = ['## Current Tasks'];

    for (const item of activeItems) {
      lines.push(`- [ ] ${item.frontmatter.name}`);
      // Include first line of body as description
      const firstLine = item.body.split('\n').find((l) => l.trim().length > 0);
      if (firstLine) {
        lines.push(`  ${firstLine.trim()}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generate the "Recent Context" section from recent episodes.
   */
  private generateRecentContextSection(): string | null {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - RECENT_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const sinceDate = cutoff.toISOString().slice(0, 10);

    const episodes = this.store.listEpisodes({ since: sinceDate });

    if (episodes.length === 0) return null;

    const lines: string[] = [
      `## Recent Context (last ${RECENT_WINDOW_HOURS}h)`,
    ];

    for (const episode of episodes.slice(0, 5)) {
      lines.push(`- ${episode.frontmatter.name}`);
      // Include first meaningful line
      const firstLine = episode.body
        .split('\n')
        .find((l) => l.trim().length > 0);
      if (firstLine && firstLine.length <= 100) {
        lines.push(`  ${firstLine.trim()}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generate the "Key Facts" section from top credit-scored entities.
   */
  private generateKeyFactsSection(): string | null {
    const topResults = this.retrieval.getTopCreditMemories(
      TOP_ENTITIES_COUNT,
    );

    // Filter to entities only
    const entityResults = topResults.filter(
      (r) =>
        r.document.frontmatter.type === 'person' ||
        r.document.frontmatter.type === 'project' ||
        r.document.frontmatter.type === 'preference',
    );

    if (entityResults.length === 0) return null;

    const lines: string[] = ['## Key Facts (top credit scores)'];

    for (const result of entityResults) {
      const { document: doc, creditScore } = result;
      // Extract first bullet point or line as a summary
      const summary = this.extractSummary(doc);
      lines.push(
        `- ${doc.frontmatter.name}: ${summary} (credit: ${creditScore.toFixed(2)})`,
      );
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generate the "Open Loops" section from items tagged as open-loop or waiting.
   */
  private generateOpenLoopsSection(): string | null {
    const allDocs = this.store.listAll();
    const openLoops = allDocs.filter(
      (doc) =>
        doc.frontmatter.tags.includes('open-loop') ||
        doc.frontmatter.tags.includes('waiting') ||
        doc.frontmatter.tags.includes('blocked'),
    );

    if (openLoops.length === 0) return null;

    const lines: string[] = ['## Open Loops'];

    for (const doc of openLoops) {
      lines.push(`- ${doc.frontmatter.name}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Extract a one-line summary from a memory document.
   */
  private extractSummary(doc: MemoryDocument): string {
    const lines = doc.body.split('\n').filter((l) => l.trim().length > 0);

    // Look for the first bullet point
    const bullet = lines.find((l) => l.trim().startsWith('- '));
    if (bullet) {
      return bullet.replace(/^-\s*/, '').trim().slice(0, 100);
    }

    // Fall back to the first non-heading line
    const nonHeading = lines.find((l) => !l.startsWith('#'));
    if (nonHeading) {
      return nonHeading.trim().slice(0, 100);
    }

    return doc.frontmatter.tags.join(', ') || 'No summary available';
  }

  /**
   * Trim content to fit within a token budget.
   */
  private trimToFit(content: string, maxTokens: number): string {
    // Try removing sections from the bottom
    const sections = content.split('\n## ');
    const result: string[] = [];
    let tokens = 0;

    for (const section of sections) {
      const sectionText =
        result.length === 0 ? section : '## ' + section;
      const sectionTokens = estimateTokens(sectionText);

      if (tokens + sectionTokens <= maxTokens) {
        result.push(sectionText);
        tokens += sectionTokens;
      } else {
        // Try to include a truncated version
        const remaining = maxTokens - tokens;
        if (remaining > 50) {
          const truncated = sectionText.slice(0, remaining * 4);
          result.push(truncated + '\n[...truncated]');
        }
        break;
      }
    }

    return result.join('\n');
  }
}
