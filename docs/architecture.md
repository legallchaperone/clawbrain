# Architecture

## Overview

The memory engine has four layers:

1. **Storage Layer** — Markdown files with YAML frontmatter + SQLite metadata
2. **Retrieval Layer** — Credit-weighted hybrid search (TF-IDF + BM25 + credit score + recency)
3. **Credit Layer** — EMA-based credit assignment from outcome signals
4. **Lifecycle Layer** — Periodic consolidation, promotion, and pruning

## Data Flow

```
Session Start
    │
    ▼
Interceptor.sessionStart()
    ├── RetrievalEngine.buildIndex()
    └── MemoryGenerator.generate() → writes MEMORY.md

User Message
    │
    ▼
Interceptor.preTurn()
    ├── buildQueryFromMessage()          # extract intent/entities
    ├── RetrievalEngine.search()         # credit-weighted search
    ├── ContextBudgetManager.select()    # fit within token budget
    ├── CreditTracker.recordRetrieval()  # log which memories were used
    └── Returns: injected memory text

Agent Response
    │
    ▼
Interceptor.postTurn()
    ├── computeTurnOutcome()             # analyze signals
    ├── CreditTracker.recordOutcome()    # update credit scores
    └── Returns: outcome summary

Heartbeat
    │
    ▼
LifecycleManager.onHeartbeat()
    ├── consolidate()  # every 24h
    ├── promote()      # every 48h
    └── prune()        # every 7d
```

## Memory Document Schema

All memory files follow this frontmatter schema:

```yaml
type: person | project | preference | episode
name: "Human-readable name"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
credit_score: 0.0–1.0     # updated by credit tracker
tags: [tag1, tag2]
pinned: false              # if true, immune to pruning
status: active             # for working memory items
entities: [slug1, slug2]   # for episodes: referenced entities
outcome: success | failure | partial | unknown  # for episodes
```

## Credit Assignment Algorithm

The credit update for memory $m$ after a turn with $n$ retrieved memories:

$$\delta_m = \frac{r}{\sqrt{n}}$$

$$s_m \leftarrow (1 - \alpha) \cdot s_m + \alpha \cdot \delta_m$$

Where:
- $r \in [-1, 1]$ is the scalar reward from outcome signals
- $n$ is the number of memories retrieved in the same turn (credit sharing)
- $\alpha$ is the learning rate (default: 0.1)
- $s_m$ is the credit score for memory $m$

Credit sharing (dividing by $\sqrt{n}$) prevents over-penalizing memories that happen to be co-retrieved with irrelevant ones.

## Retrieval Scoring

Final score for a retrieved memory $m$ given query $q$:

$$\text{score}(m, q) = 0.40 \cdot \text{sem}(m, q) + 0.20 \cdot \text{bm25}(m, q) + 0.25 \cdot s_m + 0.15 \cdot \text{recency}(m)$$

Where:
- $\text{sem}$ = cosine similarity between TF-IDF embeddings
- $\text{bm25}$ = BM25 keyword score (normalized)
- $s_m$ = credit score
- $\text{recency}(m) = e^{-\lambda \cdot \text{age}}$ with 14-day half-life

## SQLite Schema

```sql
credit_records   -- credit score, recall count per memory
credit_events    -- full history of credit updates per memory
turn_records     -- which memories were retrieved per turn + outcome
contradictions   -- detected conflicts awaiting resolution
lifecycle_log    -- history of consolidation/promotion/pruning runs
```

## File Organization

```
~/.openclaw/workspace/
├── MEMORY.md                    ← auto-generated each session
└── memory-engine/
    ├── entities/
    │   ├── people/              ← person entities (never pruned)
    │   ├── projects/            ← project entities
    │   └── preferences/         ← user preference entities
    ├── episodes/
    │   └── YYYY-MM/             ← monthly buckets
    ├── archive/                 ← soft-deleted memories
    ├── contradictions.md        ← conflicts for user review
    └── engine.db                ← SQLite metadata
```

## Extension Points

- **Embedding provider**: swap `LocalEmbedder` for OpenAI/Gemini in `src/utils/embeddings.ts`
- **Scoring weights**: pass `weights` to `RetrievalEngine` constructor
- **Outcome signals**: extend `computeTurnOutcome` in `src/utils/outcome-signals.ts`
- **Memory types**: add new frontmatter fields via the `MemoryFrontmatter` type
