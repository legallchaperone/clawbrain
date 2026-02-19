# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Docker note:** OpenClaw runs as the `node` user inside the container. The config volume must be mounted to `/home/node/.openclaw` (not `/root/.openclaw`). Use this shell command:
```bash
docker run -it --rm \
  -v ~/openclaw-data/workspace:/app/workspace \
  -v ~/openclaw-data/config:/home/node/.openclaw \
  -v ~/openclaw-data/plugins:/app/plugins \
  openclaw:local
```

```bash
npm run build        # Compile TypeScript to dist/
npm test             # Run all tests once (vitest run)
npm run test:watch   # Run tests in watch mode
npm run lint         # Lint src/ with ESLint
npm run clean        # Remove dist/

# Run a single test file
npx vitest run tests/credit-tracker.test.ts

# CLI utilities (take optional workspace_dir argument)
./scripts/dashboard.sh [workspace_dir]   # Credit stats and memory counts via SQLite
./scripts/migrate.sh [workspace_dir]     # Migrate from flat MEMORY.md to structured store
./scripts/export.sh [workspace_dir] [output.json]  # Export all memories as JSON
```

## Architecture

This is a TypeScript plugin for the **OpenClaw AI agent platform** (`openclaw.plugin.json`). It replaces OpenClaw's flat `MEMORY.md` with a credit-aware, adaptive memory system inspired by reinforcement learning credit assignment.

### Core Idea

Memories that were retrieved before successful task completions receive higher credit scores; memories that consistently fail to help are eventually pruned. The credit signal drives retrieval ranking, consolidation, promotion, and pruning.

### Storage

- **Markdown files** (with YAML frontmatter via `gray-matter`) store the human-readable memory content under `memory-engine/` in the workspace. Entity types (`person`, `project`, `preference`) live in subdirectories; episodes are bucketed monthly under `episodes/YYYY-MM/`. Archives go to `archive/`.
- **SQLite** (`engine.db`, via `better-sqlite3` in WAL mode) stores credit scores, credit events, turn records, contradiction logs, and lifecycle logs — metadata that doesn't belong in Markdown.

Key files: `src/memory-store.ts`, `src/utils/db.ts`, `src/utils/markdown-parser.ts`

### Retrieval

`RetrievalEngine` scores memories using a hybrid of four signals:

| Signal | Weight |
|--------|--------|
| TF-IDF cosine similarity | 40% |
| BM25 keyword score | 20% |
| Credit score | 25% |
| Recency decay (14-day half-life) | 15% |

Embedding provider is pluggable (`local` TF-IDF, `openai`, or `gemini`) via config. `retrieveWithinBudget()` enforces context token limits.

Key files: `src/utils/embeddings.ts`, `src/context-budget.ts`

### Credit Assignment

`CreditTracker` records which memories were retrieved per turn, then after the turn updates scores via EMA:

```
delta = reward / sqrt(n_co_retrieved)
new_score = (1 - alpha) * old_score + alpha * delta   # clamped [0,1]
```

`computeReward()` maps inferred `TurnOutcome` to [-1, 1] using regex patterns on the user message, agent response, and tool calls.

Key files: `src/credit-tracker.ts`, `src/utils/outcome-signals.ts`

### Lifecycle

`LifecycleManager.onHeartbeat()` runs three periodic operations:
- **Consolidation** (every 24h): clusters related episodes by entity overlap + content similarity, merges clusters of 3+ into a summary
- **Promotion** (every 48h): episodes with credit > 0.7 that reference entities have their facts extracted and appended to entity files
- **Pruning** (every 7d): archives memories with credit < 0.2, age > 30 days, recall count < 3. Safety rails: never prune `person` entities, pinned items, or items < 14 days old

`MemoryGenerator` regenerates a 2000-token-capped `MEMORY.md` at session start with sections: Current Tasks, Recent Context (72h), Key Facts (top credit entities), Open Loops.

`ContradictionDetector` checks new facts against entities using embedding similarity (threshold 0.6), classifies as update/conflict/duplicate, and writes genuine conflicts to `contradictions.md`.

Key files: `src/lifecycle.ts`, `src/memory-generator.ts`, `src/contradiction.ts`

### Plugin Hooks (OpenClaw integration)

`src/interceptor.ts` bridges the agent lifecycle:

| Hook | Action |
|------|--------|
| `sessionStart` | Rebuild search index, regenerate `MEMORY.md` |
| `preTurn` | Extract entities, retrieve memories within budget, inject into context, record retrieval |
| `postTurn` | Infer outcome, update credit scores |
| `preCompaction` | Regenerate `MEMORY.md` to prevent post-compaction amnesia |
| `heartbeat` | Run consolidation, promotion, pruning |

### Module Dependency Summary

```
index.ts
├── memory-store.ts → utils/markdown-parser.ts, utils/db.ts
├── credit-tracker.ts → utils/outcome-signals.ts, utils/db.ts
├── retrieval.ts → utils/embeddings.ts
├── context-budget.ts
├── memory-generator.ts
├── contradiction.ts → utils/embeddings.ts
├── lifecycle.ts → (all above)
└── interceptor.ts → utils/outcome-signals.ts
```

All TypeScript types and `DEFAULT_CONFIG` are defined in `src/types.ts`. The plugin manifest and config schema are in `openclaw.plugin.json`. Agent-facing skill instructions are in `skills/memory-engine/SKILL.md`.
