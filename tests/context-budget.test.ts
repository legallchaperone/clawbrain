import { describe, it, expect } from 'vitest';
import { ContextBudgetManager } from '../src/context-budget';
import { DEFAULT_CONFIG } from '../src/types';
import type { SearchResult, MemoryDocument } from '../src/types';

describe('ContextBudgetManager', () => {
  const manager = new ContextBudgetManager(DEFAULT_CONFIG, 200000);

  it('should calculate budget correctly', () => {
    const budget = manager.calculateBudget({
      systemPromptTokens: 5000,
      conversationTokens: 10000,
    });

    expect(budget.totalTokens).toBe(200000);
    expect(budget.systemPromptTokens).toBe(5000);
    expect(budget.conversationTokens).toBe(10000);
    expect(budget.reserveTokens).toBe(10000);
    expect(budget.availableForMemory).toBeGreaterThan(0);
    expect(budget.availableForMemory).toBeLessThanOrEqual(
      DEFAULT_CONFIG.maxContextBudget,
    );
  });

  it('should cap memory budget at maxContextBudget', () => {
    const budget = manager.calculateBudget({
      systemPromptTokens: 1000,
      conversationTokens: 1000,
    });

    // Even with lots of space, memory budget is capped
    expect(budget.availableForMemory).toBeLessThanOrEqual(
      DEFAULT_CONFIG.maxContextBudget,
    );
  });

  it('should detect tight context', () => {
    const tight = manager.calculateBudget({
      systemPromptTokens: 80000,
      conversationTokens: 80000,
    });
    expect(manager.isContextTight(tight)).toBe(true);

    const loose = manager.calculateBudget({
      systemPromptTokens: 5000,
      conversationTokens: 5000,
    });
    expect(manager.isContextTight(loose)).toBe(false);
  });

  it('should trim working memory to fit budget', () => {
    const longMemory =
      '# Active Context\n\n## Section 1\nLots of content here.\n\n## Section 2\nMore content here.\n\n## Section 3\nEven more content.';
    const budget = manager.calculateBudget({
      systemPromptTokens: 5000,
      conversationTokens: 5000,
    });

    // Set very tight working memory allocation
    const tightBudget = { ...budget, workingMemoryAllocation: 20 };
    const trimmed = manager.trimWorkingMemory(longMemory, tightBudget);
    expect(trimmed.length).toBeLessThan(longMemory.length);
  });

  it('should select memories within budget', () => {
    const mockDoc = (id: string, bodyLength: number): MemoryDocument => ({
      id,
      filePath: `entities/preferences/${id}.md`,
      frontmatter: {
        type: 'preference',
        name: id,
        created: '2026-01-01',
        updated: '2026-01-01',
        credit_score: 0.5,
        tags: [],
      },
      body: 'x'.repeat(bodyLength),
    });

    const results: SearchResult[] = [
      {
        memoryId: 'small',
        document: mockDoc('small', 100),
        semanticSimilarity: 0.8,
        bm25Score: 0.5,
        creditScore: 0.9,
        recencyScore: 0.8,
        finalScore: 0.9,
      },
      {
        memoryId: 'large',
        document: mockDoc('large', 10000),
        semanticSimilarity: 0.7,
        bm25Score: 0.4,
        creditScore: 0.8,
        recencyScore: 0.7,
        finalScore: 0.8,
      },
    ];

    const budget = manager.calculateBudget({
      systemPromptTokens: 5000,
      conversationTokens: 5000,
    });
    // Very tight budget
    const tightBudget = { ...budget, retrievedMemoryAllocation: 50 };

    const selected = manager.selectRetrievedMemories(results, tightBudget);
    // Should select only the small one
    expect(selected.length).toBe(1);
    expect(selected[0].memoryId).toBe('small');
  });

  it('should format injection text', () => {
    const mockDoc: MemoryDocument = {
      id: 'test',
      filePath: 'entities/preferences/test.md',
      frontmatter: {
        type: 'preference',
        name: 'Test Preference',
        created: '2026-01-01',
        updated: '2026-01-01',
        credit_score: 0.8,
        tags: ['test'],
      },
      body: 'User prefers TypeScript.',
    };

    const results: SearchResult[] = [
      {
        memoryId: 'test',
        document: mockDoc,
        semanticSimilarity: 0.9,
        bm25Score: 0.5,
        creditScore: 0.8,
        recencyScore: 0.7,
        finalScore: 0.85,
      },
    ];

    const formatted = manager.formatForInjection(results);
    expect(formatted).toContain('Test Preference');
    expect(formatted).toContain('0.80');
    expect(formatted).toContain('TypeScript');
  });

  it('should return empty string for no results', () => {
    const formatted = manager.formatForInjection([]);
    expect(formatted).toBe('');
  });

  it('should generate budget summary', () => {
    const budget = manager.calculateBudget({
      systemPromptTokens: 5000,
      conversationTokens: 10000,
    });
    const summary = manager.summarize(budget);
    expect(summary).toContain('Context Budget');
    expect(summary).toContain('Total');
    expect(summary).toContain('Working');
  });
});
