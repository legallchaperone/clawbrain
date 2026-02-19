/**
 * Core type definitions for the openclaw-memory-engine.
 */

// --- Memory Types ---

export type MemoryType = 'person' | 'project' | 'preference' | 'episode' | 'working';

export type EntityType = 'person' | 'project' | 'preference';

export interface MemoryFrontmatter {
  type: MemoryType;
  name: string;
  created: string;       // ISO date
  updated: string;       // ISO date
  credit_score: number;  // [0, 1]
  tags: string[];
  pinned?: boolean;
  status?: 'active' | 'archived';
  entities?: string[];   // slugs of related entities (for episodes)
  outcome?: 'success' | 'failure' | 'partial' | 'unknown';
}

export interface MemoryDocument {
  id: string;            // slug derived from file path
  filePath: string;      // relative path under memory-engine/
  frontmatter: MemoryFrontmatter;
  body: string;          // markdown content after frontmatter
}

export interface HistoryEntry {
  date: string;          // ISO date
  description: string;
  supersedes?: string;   // previous value that was replaced
}

export interface EntityDocument extends MemoryDocument {
  frontmatter: MemoryFrontmatter & {
    type: EntityType;
  };
  history: HistoryEntry[];
}

export interface EpisodeDocument extends MemoryDocument {
  frontmatter: MemoryFrontmatter & {
    type: 'episode';
    date: string;
    entities: string[];
    outcome: 'success' | 'failure' | 'partial' | 'unknown';
  };
}

// --- Credit Tracking ---

export interface TurnOutcome {
  taskCompleted: boolean;
  userSatisfaction: number;  // [-1, 1]
  toolSuccess: boolean;
  userCorrection: boolean;
  conversationAbandoned: boolean;
  conversationContinued: boolean;
}

export interface CreditEvent {
  timestamp: string;     // ISO datetime
  delta: number;
  outcome: TurnOutcome;
  coRetrieved: string[]; // IDs of other memories retrieved in same turn
}

export interface CreditRecord {
  memoryId: string;
  creditScore: number;
  recallCount: number;
  lastRecalled: string | null;
  history: CreditEvent[];
}

export interface TurnRecord {
  turnId: string;
  sessionId: string;
  timestamp: string;
  memoriesRetrieved: string[];
  outcome: TurnOutcome | null;
}

// --- Retrieval ---

export interface SearchResult {
  memoryId: string;
  document: MemoryDocument;
  semanticSimilarity: number;
  bm25Score: number;
  creditScore: number;
  recencyScore: number;
  finalScore: number;
}

export interface RetrievalQuery {
  text: string;
  entities?: string[];
  tags?: string[];
  maxResults?: number;
  minCreditScore?: number;
}

// --- Context Budget ---

export interface ContextBudget {
  totalTokens: number;
  systemPromptTokens: number;
  conversationTokens: number;
  reserveTokens: number;
  availableForMemory: number;
  workingMemoryAllocation: number;
  retrievedMemoryAllocation: number;
}

// --- Lifecycle ---

export interface ConsolidationResult {
  mergedEpisodeIds: string[];
  newEpisodeId: string;
  archivedCount: number;
}

export interface PromotionResult {
  episodeId: string;
  extractedFacts: string[];
  targetEntityId: string;
}

export interface PruneResult {
  prunedIds: string[];
  archivedIds: string[];
  protectedIds: string[];
}

// --- Contradiction ---

export interface Contradiction {
  id: string;
  entityId: string;
  existingFact: string;
  newFact: string;
  detectedAt: string;
  resolved: boolean;
  resolution?: 'update' | 'conflict' | 'duplicate';
  resolvedAt?: string;
}

// --- Configuration ---

export interface PluginConfig {
  creditAlpha: number;
  consolidationInterval: string;
  promotionInterval: string;
  pruneInterval: string;
  pruneThreshold: number;
  pruneMinAge: number;
  maxContextBudget: number;
  embeddingProvider: 'local' | 'openai' | 'gemini';
  enableContradictionDetection: boolean;
  debug: boolean;
}

export const DEFAULT_CONFIG: PluginConfig = {
  creditAlpha: 0.1,
  consolidationInterval: '24h',
  promotionInterval: '48h',
  pruneInterval: '7d',
  pruneThreshold: 0.2,
  pruneMinAge: 30,
  maxContextBudget: 5000,
  embeddingProvider: 'local',
  enableContradictionDetection: true,
  debug: false,
};

// --- Plugin Hooks ---

export interface HookContext {
  sessionId: string;
  turnId: string;
  userMessage?: string;
  agentResponse?: string;
  toolCalls?: ToolCallRecord[];
  workspaceDir: string;
  config: PluginConfig;
}

export interface ToolCallRecord {
  name: string;
  success: boolean;
  args?: Record<string, unknown>;
}
