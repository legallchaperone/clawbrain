# clawbrain

**Credit-assignment, self-evolving memory** for OpenClaw agents. Replaces the flat `MEMORY.md` approach with a structured, outcome-optimized memory system that learns which memories actually helped the agent succeed — and forgets the ones that didn't.

## The Core Problem

OpenClaw's built-in memory stores everything equally and never learns from outcomes:

- Post-compaction amnesia: important details get lost when context is summarized
- Context budget waste: `MEMORY.md` grows until it crowds out conversation history
- No contradiction handling: old and new facts coexist with no resolution
- No feedback loop: the system never learns which memories were actually useful

## The Core Insight

> **Track which memories were retrieved before successful task completions, and use this signal to score, consolidate, and prune memories over time.**

This is counterfactual credit assignment from reinforcement learning, applied to memory management. The difference from recall-frequency tracking: we don't just count "how often was this memory accessed" but "how often did accessing this memory precede a good outcome."

## Architecture

```
┌──────────────────────────────────────────┐
│            OpenClaw Agent                │
│                                          │
│  preTurn → Interceptor → retrieve+inject │
│  postTurn → CreditTracker → update score │
│  heartbeat → LifecycleManager → maintain │
│  sessionStart → MemoryGenerator → regen  │
└──────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
  memory-engine/          engine.db (SQLite)
  ├── entities/           ├── credit_records
  │   ├── people/         ├── credit_events
  │   ├── projects/       ├── turn_records
  │   └── preferences/    ├── contradictions
  ├── episodes/           └── lifecycle_log
  └── archive/
```

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Memory Store | `src/memory-store.ts` | CRUD for entities and episodes |
| Credit Tracker | `src/credit-tracker.ts` | Outcome detection and credit updates |
| Retrieval Engine | `src/retrieval.ts` | Credit-weighted search |
| Context Budget | `src/context-budget.ts` | Dynamic context allocation |
| Memory Generator | `src/memory-generator.ts` | Per-session MEMORY.md generation |
| Contradiction Detector | `src/contradiction.ts` | Conflict detection and resolution |
| Lifecycle Manager | `src/lifecycle.ts` | Consolidation, promotion, pruning |
| Interceptor | `src/interceptor.ts` | Pre/post turn hooks |

## Installation

### From a local directory (recommended for self-hosted/Docker)

Build the plugin first, then install it into OpenClaw:

```bash
npm install
npm run build
openclaw plugins install /path/to/clawbrain
openclaw plugins enable clawbrain
```

#### Docker

OpenClaw runs as the `node` user inside the container. Mount your config volume to
`/home/node/.openclaw` (not `/root/.openclaw`):

```bash
# One-time install (copy to the shared config volume, then install inside Docker)
cp -r . ~/openclaw-data/plugins/clawbrain/

docker run --rm \
  -v ~/openclaw-data/config:/home/node/.openclaw \
  -v ~/openclaw-data/plugins:/app/plugins \
  openclaw:local \
  sh -c "cd /app/plugins/clawbrain && npm install --omit=dev \
         && cd /app && node openclaw.mjs plugins install /app/plugins/clawbrain \
         && node openclaw.mjs plugins enable clawbrain"
```

Then use this corrected volume mount for all future `docker run` invocations:

```bash
docker run -it --rm \
  -v ~/openclaw-data/workspace:/app/workspace \
  -v ~/openclaw-data/config:/home/node/.openclaw \
  -v ~/openclaw-data/plugins:/app/plugins \
  openclaw:local
```

### Migrate existing memories

```bash
./scripts/migrate.sh ~/.openclaw/memory-engine
```

## Configuration

In `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "clawbrain": {
        "enabled": true,
        "config": {
          "creditAlpha": 0.1,
          "consolidationInterval": "24h",
          "pruneThreshold": 0.2,
          "pruneMinAge": 30,
          "maxContextBudget": 5000,
          "embeddingProvider": "local",
          "enableContradictionDetection": true,
          "debug": false
        }
      }
    }
  }
}
```

## Memory Types

### Entities (Semantic Memory)

Durable facts about people, projects, and preferences:

```
memory-engine/entities/
├── people/alice-chen.md
├── projects/atlas.md
└── preferences/typescript-pref.md
```

### Episodes (Episodic Memory)

Summaries of significant interactions:

```
memory-engine/episodes/
└── 2026-02/
    └── debugging-session-atlas.md
```

### Working Memory

Auto-generated `MEMORY.md` at each session start, pulling the most relevant content from the structured store.

## Credit Assignment

The credit tracker uses exponential moving average (EMA) updates:

```
delta = reward / sqrt(n)   # credit sharing across n co-retrieved memories
new_score = (1 - α) * old_score + α * delta
```

Where `reward` is computed from outcome signals:

| Signal | Reward |
|--------|--------|
| Task completed | +0.5 |
| Positive user feedback | +0.3 |
| Tool call success | +0.1 |
| User correction | -0.4 |
| Session abandoned | -0.2 |

## Lifecycle Management

- **Consolidation** (every 24h): merge related episodes into summaries
- **Promotion** (every 48h): extract high-credit episode facts into entities
- **Pruning** (every 7d): archive low-credit memories with safety rails

### Pruning Safety Rails

- Never prune `person` entities
- Never prune `pinned: true` items
- Never prune items younger than 14 days

## CLI Dashboard

```bash
./scripts/dashboard.sh ~/.openclaw/workspace
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
