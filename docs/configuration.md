# Configuration Reference

All options are set in `~/.openclaw/openclaw.json` under the plugin config.

## creditAlpha

**Type**: `number` | **Default**: `0.1`

Learning rate for credit updates (EMA alpha). Controls how quickly credit
scores respond to new outcomes.

- Lower (e.g., 0.05): stable, slow to adapt, good for consistent long-term use
- Higher (e.g., 0.3): reactive, fast to adapt, good for rapidly changing tasks

## consolidationInterval

**Type**: `string` | **Default**: `"24h"`

How often to run episodic consolidation. Format: `Nh` (hours) or `Nd` (days).

Examples: `"12h"`, `"24h"`, `"2d"`

## promotionInterval

**Type**: `string` | **Default**: `"48h"`

How often to run fact promotion from episodes to entities.

## pruneInterval

**Type**: `string` | **Default**: `"7d"`

How often to run memory pruning.

## pruneThreshold

**Type**: `number` | **Default**: `0.2`

Credit score below which a memory becomes a pruning candidate.
Memories must also pass the age and recall count filters.

## pruneMinAge

**Type**: `number` | **Default**: `30`

Minimum age in days before a memory can be pruned.

Note: there is also a hard-coded 14-day protection that applies to ALL memories,
regardless of this setting.

## maxContextBudget

**Type**: `number` | **Default**: `5000`

Maximum number of tokens allocated to memory injection in a single turn.
Split 40/60 between working memory and retrieved memories.

## embeddingProvider

**Type**: `"local" | "openai" | "gemini"` | **Default**: `"local"`

Embedding provider for semantic search.

- `local`: TF-IDF based, no API calls, works offline (recommended for most users)
- `openai`: Uses OpenAI embeddings API (requires `OPENAI_API_KEY`)
- `gemini`: Uses Google Gemini embeddings API (requires `GEMINI_API_KEY`)

## enableContradictionDetection

**Type**: `boolean` | **Default**: `true`

Whether to check for conflicting facts when entities are updated.
Detected conflicts are written to `memory-engine/contradictions.md`.

## debug

**Type**: `boolean` | **Default**: `false`

Enable verbose logging. Prints retrieval counts, credit updates, and
lifecycle actions to the console.
