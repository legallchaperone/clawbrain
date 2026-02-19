---
name: memory-engine
description: >
  Advanced memory management with credit-aware retrieval, structured entity
  storage, and automatic lifecycle management. Replaces flat MEMORY.md with
  a dynamic, outcome-optimized memory system.
metadata:
  openclaw:
    requires:
      tools: [read, write, edit]
---

# Memory Engine

You have an advanced memory system. Key behaviors:

## Writing Memories

- **Entities**: When learning durable facts about people, projects, or
  preferences, write to `memory-engine/entities/<type>/<slug>.md` with
  YAML frontmatter (type, name, created, tags).
- **Episodes**: After completing significant tasks or conversations,
  write a summary to `memory-engine/episodes/YYYY-MM/<slug>.md`.
- **Working items**: Tag active tasks with `status: active` in frontmatter.

## Reading Memories

- Your MEMORY.md is auto-generated each session with your most relevant context.
- Use `memory_search` for deeper lookups — results are ranked by relevance
  AND historical utility (credit score).
- If a memory seems wrong or outdated, update the entity file and note
  the change in its History section.

## Contradictions

- If you notice conflicting information, check `memory-engine/contradictions.md`.
- When updating a fact, always note what it supersedes in the History section.

## Pinning

- Add `pinned: true` to any memory's frontmatter to prevent auto-pruning.

## Credit System

- Memories that contribute to successful task completions earn higher credit scores.
- High-credit memories are prioritized in retrieval and protected from pruning.
- Low-credit memories are gradually archived to keep the system clean.
- The credit system learns automatically — no manual intervention needed.

## Entity Types

### People
Stored in `memory-engine/entities/people/`. Track coworkers, contacts, and
important individuals. People entities are never auto-pruned.

### Projects
Stored in `memory-engine/entities/projects/`. Track ongoing projects, their
tech stacks, key people, and status.

### Preferences
Stored in `memory-engine/entities/preferences/`. Track user preferences for
tools, languages, workflows, and communication styles.
