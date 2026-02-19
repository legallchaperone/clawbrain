/**
 * Interceptor — Pre/Post Turn Hooks
 *
 * Hooks into OpenClaw's agent lifecycle to:
 * - Pre-turn: retrieve relevant memories and inject into context
 * - Post-turn: detect outcomes and update credit scores
 * - Pre-compaction: flush important information to durable storage
 * - Session start: rebuild search index and regenerate MEMORY.md
 */

import { v4 as uuidv4 } from 'uuid';
import type { HookContext, RetrievalQuery, TurnOutcome } from './types';
import { CreditTracker } from './credit-tracker';
import { RetrievalEngine } from './retrieval';
import { MemoryGenerator } from './memory-generator';
import { ContextBudgetManager } from './context-budget';
import { MemoryStore } from './memory-store';
import {
  computeTurnOutcome,
  analyzeUserMessage,
} from './utils/outcome-signals';
import { estimateTokens } from './utils/markdown-parser';

export class Interceptor {
  private store: MemoryStore;
  private creditTracker: CreditTracker;
  private retrieval: RetrievalEngine;
  private memoryGenerator: MemoryGenerator;
  private budgetManager: ContextBudgetManager;

  /** Track the current turn ID for credit assignment. */
  private currentTurnId: string | null = null;

  constructor(
    store: MemoryStore,
    creditTracker: CreditTracker,
    retrieval: RetrievalEngine,
    memoryGenerator: MemoryGenerator,
    budgetManager: ContextBudgetManager,
  ) {
    this.store = store;
    this.creditTracker = creditTracker;
    this.retrieval = retrieval;
    this.memoryGenerator = memoryGenerator;
    this.budgetManager = budgetManager;
  }

  /**
   * Session start hook.
   * Rebuilds the search index and regenerates MEMORY.md.
   */
  async sessionStart(context: HookContext): Promise<{
    workingMemory: string;
  }> {
    // Build search index
    this.retrieval.buildIndex();

    // Generate fresh MEMORY.md
    const workingMemory = this.memoryGenerator.generate();

    if (context.config.debug) {
      console.log('[memory-engine] Session started. MEMORY.md regenerated.');
    }

    return { workingMemory };
  }

  /**
   * Pre-turn hook.
   * Analyzes the user message, retrieves relevant memories,
   * and injects them into the context.
   */
  async preTurn(context: HookContext): Promise<{
    injectedMemories: string;
    turnId: string;
    retrievedIds: string[];
  }> {
    this.currentTurnId = context.turnId || uuidv4();

    if (!context.userMessage) {
      return {
        injectedMemories: '',
        turnId: this.currentTurnId,
        retrievedIds: [],
      };
    }

    // Extract entities and topics from the user message
    const query = this.buildQueryFromMessage(context.userMessage);

    // Calculate context budget
    const budget = this.budgetManager.calculateBudget({
      systemPromptTokens: estimateTokens(context.userMessage) + 2000,
      conversationTokens: estimateTokens(context.userMessage),
    });

    // Retrieve memories within budget
    const results = this.retrieval.retrieveWithinBudget(
      query,
      budget.retrievedMemoryAllocation,
    );

    // Record retrievals for credit tracking
    const retrievedIds = results.map((r) => r.memoryId);
    this.creditTracker.recordRetrieval(this.currentTurnId, retrievedIds);

    // Format for injection
    const injectedMemories = this.budgetManager.formatForInjection(results);

    if (context.config.debug) {
      console.log(
        `[memory-engine] Pre-turn: retrieved ${results.length} memories for turn ${this.currentTurnId}`,
      );
    }

    return {
      injectedMemories,
      turnId: this.currentTurnId,
      retrievedIds,
    };
  }

  /**
   * Post-turn hook.
   * Detects the outcome of the turn and updates credit scores.
   */
  async postTurn(context: HookContext): Promise<{
    outcome: TurnOutcome;
    creditUpdated: boolean;
  }> {
    const turnId = this.currentTurnId;
    if (!turnId) {
      return {
        outcome: {
          taskCompleted: false,
          userSatisfaction: 0,
          toolSuccess: true,
          userCorrection: false,
          conversationAbandoned: false,
          conversationContinued: true,
        },
        creditUpdated: false,
      };
    }

    // Compute outcome from available signals
    const outcome = computeTurnOutcome({
      userMessage: context.userMessage,
      agentResponse: context.agentResponse,
      toolCalls: context.toolCalls,
      sessionEndedAbruptly: false,
    });

    // Update credit scores
    this.creditTracker.recordOutcome(turnId, context.sessionId, outcome);

    if (context.config.debug) {
      console.log(
        `[memory-engine] Post-turn: outcome recorded for turn ${turnId}`,
        outcome,
      );
    }

    this.currentTurnId = null;
    return { outcome, creditUpdated: true };
  }

  /**
   * Pre-compaction hook.
   * Called before context compaction to flush important data to storage.
   */
  async preCompaction(context: HookContext): Promise<void> {
    // Regenerate MEMORY.md to ensure latest state is captured
    this.memoryGenerator.generate();

    if (context.config.debug) {
      console.log(
        '[memory-engine] Pre-compaction: MEMORY.md regenerated before compaction.',
      );
    }
  }

  /**
   * Build a retrieval query from a user message.
   */
  private buildQueryFromMessage(message: string): RetrievalQuery {
    // Extract potential entity references (capitalized words)
    const entityPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;
    const potentialEntities = message.match(entityPattern) ?? [];
    const entitySlugs = potentialEntities.map((e) =>
      e.toLowerCase().replace(/\s+/g, '-'),
    );

    return {
      text: message,
      entities: entitySlugs.length > 0 ? entitySlugs : undefined,
      maxResults: 10,
    };
  }
}

/**
 * Factory function to create standalone hook handlers
 * for the OpenClaw plugin system.
 */
export function createHookHandlers(interceptor: Interceptor) {
  return {
    sessionStart: (ctx: HookContext) => interceptor.sessionStart(ctx),
    preTurn: (ctx: HookContext) => interceptor.preTurn(ctx),
    postTurn: (ctx: HookContext) => interceptor.postTurn(ctx),
    preCompaction: (ctx: HookContext) => interceptor.preCompaction(ctx),
  };
}
