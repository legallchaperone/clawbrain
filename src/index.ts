/**
 * clawbrain — Plugin Entry Point
 *
 * Initializes all components and registers hooks with OpenClaw.
 * This is the main export consumed by the plugin system.
 */

import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { PluginConfig, HookContext } from './types';
import { DEFAULT_CONFIG } from './types';
import { MetadataDB } from './utils/db';
import { MemoryStore } from './memory-store';
import { CreditTracker } from './credit-tracker';
import { RetrievalEngine } from './retrieval';
import { ContextBudgetManager } from './context-budget';
import { MemoryGenerator } from './memory-generator';
import { ContradictionDetector } from './contradiction';
import { LifecycleManager } from './lifecycle';
import { Interceptor, createHookHandlers } from './interceptor';

export interface MemoryEngineInstance {
  store: MemoryStore;
  creditTracker: CreditTracker;
  retrieval: RetrievalEngine;
  budgetManager: ContextBudgetManager;
  memoryGenerator: MemoryGenerator;
  contradictionDetector: ContradictionDetector;
  lifecycle: LifecycleManager;
  interceptor: Interceptor;
  hooks: ReturnType<typeof createHookHandlers>;
  db: MetadataDB;
  shutdown: () => void;
}

/**
 * Initialize the memory engine with the given workspace directory and config.
 */
export function createMemoryEngine(
  workspaceDir: string,
  userConfig: Partial<PluginConfig> = {},
): MemoryEngineInstance {
  const config: PluginConfig = { ...DEFAULT_CONFIG, ...userConfig };

  const dbPath = path.join(workspaceDir, 'memory-engine', 'engine.db');
  const db = new MetadataDB(dbPath);

  const store = new MemoryStore(workspaceDir, db, config);
  const creditTracker = new CreditTracker(db, config);
  const retrieval = new RetrievalEngine(store, db, config);
  const budgetManager = new ContextBudgetManager(config);
  const memoryGenerator = new MemoryGenerator(store, retrieval, config, workspaceDir);
  const contradictionDetector = new ContradictionDetector(db, config);
  const lifecycle = new LifecycleManager(
    store,
    creditTracker,
    contradictionDetector,
    db,
    config,
  );
  const interceptor = new Interceptor(
    store,
    creditTracker,
    retrieval,
    memoryGenerator,
    budgetManager,
  );
  const hooks = createHookHandlers(interceptor);

  return {
    store,
    creditTracker,
    retrieval,
    budgetManager,
    memoryGenerator,
    contradictionDetector,
    lifecycle,
    interceptor,
    hooks,
    db,
    shutdown: () => db.close(),
  };
}

// --- OpenClaw Plugin Interface ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function register(api: any): void {
  // Plugin data lives under the OpenClaw state dir so it survives restarts
  const stateDir: string = api.runtime.state.resolveStateDir();
  const workspaceDir: string = path.join(stateDir, 'memory-engine');
  const pluginConfig: Partial<PluginConfig> =
    (api.pluginConfig as Partial<PluginConfig>) ?? {};

  let engine: MemoryEngineInstance | null = null;
  let currentSessionId = '';
  let currentTurnId = '';
  let sessionWorkingMemory = '';

  function getEngine(): MemoryEngineInstance {
    if (!engine) {
      engine = createMemoryEngine(workspaceDir, pluginConfig);
    }
    return engine;
  }

  function makeContext(overrides: Partial<HookContext> = {}): HookContext {
    return {
      sessionId: currentSessionId,
      turnId: currentTurnId || uuidv4(),
      config: { ...DEFAULT_CONFIG, ...pluginConfig },
      workspaceDir,
      ...overrides,
    };
  }

  // Rebuild search index and warm up working memory summary at session start
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.on('session_start', async (event: any) => {
    currentSessionId = (event?.sessionId as string | undefined) ?? uuidv4();
    const eng = getEngine();
    const result = await eng.interceptor.sessionStart(
      makeContext({ sessionId: currentSessionId }),
    );
    sessionWorkingMemory = result.workingMemory;
  });

  // Retrieve relevant memories and inject them before the prompt is built
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.on('before_prompt_build', async (event: any) => {
    const userMessage: string =
      (event?.latestUserMessage as string | undefined) ??
      (event?.userMessage as string | undefined) ??
      '';
    currentTurnId = (event?.turnId as string | undefined) ?? uuidv4();

    const ctx = makeContext({ userMessage, turnId: currentTurnId });
    const eng = getEngine();
    const result = await eng.interceptor.preTurn(ctx);

    const parts: string[] = [];
    if (sessionWorkingMemory) parts.push(sessionWorkingMemory);
    if (result.injectedMemories) parts.push(result.injectedMemories);

    if (parts.length > 0) {
      return { prependContext: parts.join('\n\n---\n\n') };
    }
    return {};
  });

  // Infer outcome and update credit scores after the agent finishes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api.on('agent_end', async (event: any) => {
    const ctx = makeContext({
      userMessage:
        (event?.input?.latestUserMessage as string | undefined) ?? '',
      agentResponse:
        typeof event?.output === 'string'
          ? event.output
          : ((event?.output?.text as string | undefined) ?? ''),
      turnId: currentTurnId,
    });
    const eng = getEngine();
    await eng.interceptor.postTurn(ctx);
    currentTurnId = '';
  });

  // Refresh MEMORY.md before context compaction
  api.on('before_compaction', async () => {
    const eng = getEngine();
    await eng.interceptor.preCompaction(makeContext());
    sessionWorkingMemory = eng.memoryGenerator.generate();
  });

  // Hourly background heartbeat for consolidation, promotion, and pruning
  api.registerService({
    id: 'memory-engine-heartbeat',
    start: () => {
      const interval = setInterval(() => {
        if (engine) {
          engine.lifecycle.onHeartbeat().catch((err: Error) => {
            console.error('[memory-engine] Heartbeat error:', err);
          });
        }
      }, 60 * 60 * 1000);
      return () => clearInterval(interval);
    },
  });
}

// Re-export types and components for external use
export type { PluginConfig, HookContext } from './types';
export { DEFAULT_CONFIG } from './types';
export { MemoryStore } from './memory-store';
export { CreditTracker } from './credit-tracker';
export { RetrievalEngine } from './retrieval';
export { ContextBudgetManager } from './context-budget';
export { MemoryGenerator } from './memory-generator';
export { ContradictionDetector } from './contradiction';
export { LifecycleManager } from './lifecycle';
export { Interceptor } from './interceptor';
export { MetadataDB } from './utils/db';
