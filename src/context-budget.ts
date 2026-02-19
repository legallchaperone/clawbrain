/**
 * Context Budget Manager
 *
 * Dynamically allocates the available context window between
 * working memory, retrieved memories, and the rest of the prompt.
 * Ensures memory injection doesn't crowd out conversation history
 * or system instructions.
 */

import type { ContextBudget, PluginConfig, SearchResult } from './types';
import { estimateTokens } from './utils/markdown-parser';

/** Default context window size (tokens). */
const DEFAULT_CONTEXT_WINDOW = 200000;

/** Minimum reserve for agent reasoning and tool output. */
const MIN_RESERVE = 10000;

/** Allocation ratios for the available memory budget. */
const WORKING_MEMORY_RATIO = 0.4;
const RETRIEVED_MEMORY_RATIO = 0.6;

export class ContextBudgetManager {
  private config: PluginConfig;
  private contextWindow: number;

  constructor(config: PluginConfig, contextWindow?: number) {
    this.config = config;
    this.contextWindow = contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  }

  /**
   * Calculate the context budget given current usage.
   */
  calculateBudget(params: {
    systemPromptTokens: number;
    conversationTokens: number;
  }): ContextBudget {
    const reserveTokens = MIN_RESERVE;
    const usedTokens =
      params.systemPromptTokens + params.conversationTokens + reserveTokens;

    const rawAvailable = this.contextWindow - usedTokens;
    const availableForMemory = Math.min(
      Math.max(rawAvailable, 0),
      this.config.maxContextBudget,
    );

    const workingMemoryAllocation = Math.floor(
      availableForMemory * WORKING_MEMORY_RATIO,
    );
    const retrievedMemoryAllocation = Math.floor(
      availableForMemory * RETRIEVED_MEMORY_RATIO,
    );

    return {
      totalTokens: this.contextWindow,
      systemPromptTokens: params.systemPromptTokens,
      conversationTokens: params.conversationTokens,
      reserveTokens,
      availableForMemory,
      workingMemoryAllocation,
      retrievedMemoryAllocation,
    };
  }

  /**
   * Determine if context is "tight" (less than 30% available for memory).
   */
  isContextTight(budget: ContextBudget): boolean {
    const totalUsed =
      budget.systemPromptTokens +
      budget.conversationTokens +
      budget.reserveTokens;
    const ratio = totalUsed / budget.totalTokens;
    return ratio > 0.7;
  }

  /**
   * Trim a working memory string to fit within the allocated budget.
   */
  trimWorkingMemory(
    workingMemory: string,
    budget: ContextBudget,
  ): string {
    const currentTokens = estimateTokens(workingMemory);

    if (currentTokens <= budget.workingMemoryAllocation) {
      return workingMemory;
    }

    // Split into sections and progressively trim
    const sections = workingMemory.split('\n## ');
    const result: string[] = [];
    let usedTokens = 0;

    for (const section of sections) {
      const sectionTokens = estimateTokens(section);
      if (usedTokens + sectionTokens <= budget.workingMemoryAllocation) {
        result.push(section);
        usedTokens += sectionTokens;
      }
    }

    if (result.length === 0 && sections.length > 0) {
      // At minimum, include a truncated version of the first section
      const maxChars = budget.workingMemoryAllocation * 4;
      return sections[0].slice(0, maxChars) + '\n\n[...truncated]';
    }

    return result.join('\n## ');
  }

  /**
   * Select retrieved memories that fit within the budget.
   * Prioritizes by final score.
   */
  selectRetrievedMemories(
    results: SearchResult[],
    budget: ContextBudget,
  ): SearchResult[] {
    const selected: SearchResult[] = [];
    let usedTokens = 0;
    const allocation = budget.retrievedMemoryAllocation;

    // Results should already be sorted by finalScore
    for (const result of results) {
      const tokens = estimateTokens(
        result.document.body + result.document.frontmatter.name,
      );
      if (usedTokens + tokens > allocation) continue;
      selected.push(result);
      usedTokens += tokens;
    }

    return selected;
  }

  /**
   * Format retrieved memories for injection into the context.
   */
  formatForInjection(results: SearchResult[]): string {
    if (results.length === 0) return '';

    const lines: string[] = ['## Retrieved Memories\n'];

    for (const result of results) {
      const { document: doc } = result;
      lines.push(
        `### ${doc.frontmatter.name} (credit: ${result.creditScore.toFixed(2)})`,
      );
      lines.push(`_Type: ${doc.frontmatter.type} | Tags: ${doc.frontmatter.tags.join(', ') || 'none'}_\n`);

      // Truncate body if needed
      const maxBodyChars = 500;
      if (doc.body.length > maxBodyChars) {
        lines.push(doc.body.slice(0, maxBodyChars) + '...\n');
      } else {
        lines.push(doc.body + '\n');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get a budget summary string for debug logging.
   */
  summarize(budget: ContextBudget): string {
    const usedPct = (
      ((budget.systemPromptTokens +
        budget.conversationTokens +
        budget.reserveTokens) /
        budget.totalTokens) *
      100
    ).toFixed(1);

    return [
      `Context Budget: ${usedPct}% used`,
      `  Total: ${budget.totalTokens}`,
      `  System: ${budget.systemPromptTokens}`,
      `  Conversation: ${budget.conversationTokens}`,
      `  Reserve: ${budget.reserveTokens}`,
      `  Available for memory: ${budget.availableForMemory}`,
      `    Working: ${budget.workingMemoryAllocation}`,
      `    Retrieved: ${budget.retrievedMemoryAllocation}`,
    ].join('\n');
  }
}
