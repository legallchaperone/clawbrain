/**
 * openclaw-memory-engine — Plugin Entry Point
 *
 * Initializes all components and registers hooks with OpenClaw.
 * This is the main export consumed by the plugin system.
 */

import * as path from 'path';
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

  // Initialize database
  const dbPath = path.join(workspaceDir, 'memory-engine', 'engine.db');
  const db = new MetadataDB(dbPath);

  // Initialize core components
  const store = new MemoryStore(workspaceDir, db, config);
  const creditTracker = new CreditTracker(db, config);
  const retrieval = new RetrievalEngine(store, db, config);
  const budgetManager = new ContextBudgetManager(config);
  const memoryGenerator = new MemoryGenerator(
    store,
    retrieval,
    config,
    workspaceDir,
  );
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

  // Create hook handlers
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

let instance: MemoryEngineInstance | null = null;

/**
 * Plugin activation handler.
 * Called by OpenClaw when the plugin is loaded.
 */
export function activate(context: {
  workspaceDir: string;
  config?: Partial<PluginConfig>;
}): void {
  instance = createMemoryEngine(context.workspaceDir, context.config);
}

/**
 * Plugin deactivation handler.
 */
export function deactivate(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

/**
 * Get the current engine instance.
 */
export function getInstance(): MemoryEngineInstance | null {
  return instance;
}

// --- Hook Exports ---

export async function sessionStart(context: HookContext): Promise<unknown> {
  if (!instance) return {};
  return instance.hooks.sessionStart(context);
}

export async function preTurn(context: HookContext): Promise<unknown> {
  if (!instance) return {};
  return instance.hooks.preTurn(context);
}

export async function postTurn(context: HookContext): Promise<unknown> {
  if (!instance) return {};
  return instance.hooks.postTurn(context);
}

export async function preCompaction(context: HookContext): Promise<void> {
  if (!instance) return;
  return instance.hooks.preCompaction(context);
}

export async function heartbeat(): Promise<void> {
  if (!instance) return;
  return instance.lifecycle.onHeartbeat();
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
