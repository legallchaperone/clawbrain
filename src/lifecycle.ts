/**
 * Lifecycle Manager
 *
 * Runs periodic maintenance operations on the memory store:
 * - Consolidation: merge related episodic memories
 * - Promotion: extract durable facts from episodes into entities
 * - Pruning: remove low-value memories with safety rails
 *
 * Designed to run on OpenClaw's heartbeat/cron system.
 */

import type {
  PluginConfig,
  EpisodeDocument,
  EntityDocument,
  ConsolidationResult,
  PromotionResult,
  PruneResult,
} from './types';
import { MemoryStore } from './memory-store';
import { CreditTracker } from './credit-tracker';
import { ContradictionDetector } from './contradiction';
import { MetadataDB } from './utils/db';
import { LocalEmbedder } from './utils/embeddings';

export class LifecycleManager {
  private store: MemoryStore;
  private creditTracker: CreditTracker;
  private contradictionDetector: ContradictionDetector;
  private db: MetadataDB;
  private config: PluginConfig;

  constructor(
    store: MemoryStore,
    creditTracker: CreditTracker,
    contradictionDetector: ContradictionDetector,
    db: MetadataDB,
    config: PluginConfig,
  ) {
    this.store = store;
    this.creditTracker = creditTracker;
    this.contradictionDetector = contradictionDetector;
    this.db = db;
    this.config = config;
  }

  /**
   * Heartbeat handler. Checks if any lifecycle operations are due and runs them.
   */
  async onHeartbeat(): Promise<void> {
    const now = new Date();

    if (this.isDue('consolidation', this.config.consolidationInterval, now)) {
      await this.consolidate();
      this.db.logLifecycleAction('consolidation', { timestamp: now.toISOString() });
    }

    if (this.isDue('promotion', this.config.promotionInterval, now)) {
      await this.promote();
      this.db.logLifecycleAction('promotion', { timestamp: now.toISOString() });
    }

    if (this.isDue('pruning', this.config.pruneInterval, now)) {
      await this.prune();
      this.db.logLifecycleAction('pruning', { timestamp: now.toISOString() });
    }
  }

  /**
   * Consolidation: merge related episodic memories.
   *
   * Algorithm:
   * 1. Find episodes with overlapping entities and similar content
   * 2. If a cluster has 3+ episodes, summarize into one
   * 3. Preserve the highest credit score from the cluster
   * 4. Archive originals
   */
  async consolidate(): Promise<ConsolidationResult[]> {
    const episodes = this.store.listEpisodes();
    if (episodes.length < 3) return [];

    const clusters = this.clusterEpisodes(episodes);
    const results: ConsolidationResult[] = [];

    for (const cluster of clusters) {
      if (cluster.length < 3) continue;

      // Find the highest credit score in the cluster
      const maxCredit = Math.max(
        ...cluster.map((ep) => this.creditTracker.getCreditScore(ep.id)),
      );

      // Build a consolidated summary
      const consolidatedName = this.buildConsolidatedName(cluster);
      const consolidatedBody = this.buildConsolidatedBody(cluster);

      // Collect all entities referenced
      const allEntities = [
        ...new Set(cluster.flatMap((ep) => ep.frontmatter.entities)),
      ];
      const allTags = [
        ...new Set(cluster.flatMap((ep) => ep.frontmatter.tags)),
      ];

      // Create the consolidated episode
      const newEpisode = this.store.createEpisode(
        consolidatedName,
        consolidatedBody,
        allEntities,
        'success',
        [...allTags, 'consolidated'],
      );

      // Set the credit score to the max from the cluster
      this.creditTracker.manualAdjust(
        newEpisode.id,
        maxCredit - 0.5, // Adjust relative to default
      );

      // Archive the originals
      const archivedIds: string[] = [];
      for (const episode of cluster) {
        if (this.store.archiveEpisode(episode.id)) {
          archivedIds.push(episode.id);
        }
      }

      results.push({
        mergedEpisodeIds: cluster.map((ep) => ep.id),
        newEpisodeId: newEpisode.id,
        archivedCount: archivedIds.length,
      });
    }

    return results;
  }

  /**
   * Promotion: move high-credit episodic facts to semantic memory.
   *
   * Algorithm:
   * 1. Find episodes with credit_score > 0.7 that contain entity-level facts
   * 2. Extract facts and upsert into entity files
   * 3. Update entity credit scores (weighted average)
   */
  async promote(): Promise<PromotionResult[]> {
    const episodes = this.store.listEpisodes();
    const results: PromotionResult[] = [];

    for (const episode of episodes) {
      const credit = this.creditTracker.getCreditScore(episode.id);
      if (credit < 0.7) continue;

      // Check if episode has entity references
      if (episode.frontmatter.entities.length === 0) continue;

      // Extract facts from the episode
      const facts = this.extractPromotableFacts(episode);
      if (facts.length === 0) continue;

      // For each referenced entity, try to add the facts
      for (const entitySlug of episode.frontmatter.entities) {
        const entity = this.store.getEntity(entitySlug);
        if (!entity) continue;

        // Check for contradictions before adding
        for (const fact of facts) {
          if (this.config.enableContradictionDetection) {
            const contradictions =
              this.contradictionDetector.checkForContradictions(entity, fact);

            for (const c of contradictions) {
              this.contradictionDetector.resolve(c, entity);
            }
          }
        }

        // Add facts to entity body
        const updatedBody = this.appendFacts(entity, facts);
        this.store.updateEntity(entitySlug, {
          body: updatedBody,
          historyEntry: {
            date: new Date().toISOString().slice(0, 10),
            description: `Promoted facts from episode: ${episode.frontmatter.name}`,
          },
        });

        results.push({
          episodeId: episode.id,
          extractedFacts: facts,
          targetEntityId: entitySlug,
        });
      }
    }

    return results;
  }

  /**
   * Pruning: remove low-value memories with safety rails.
   *
   * Algorithm:
   * 1. Find memories with credit_score < threshold AND age > minAge AND recall_count < 3
   * 2. Apply protection rules (never prune people, pinned items, or recent items)
   * 3. Archive qualifying memories (soft delete)
   */
  async prune(): Promise<PruneResult> {
    const lowCreditIds = this.creditTracker.getLowCreditMemories();
    const prunedIds: string[] = [];
    const archivedIds: string[] = [];
    const protectedIds: string[] = [];

    for (const memoryId of lowCreditIds) {
      const doc = this.store.getById(memoryId);
      if (!doc) continue;

      // Protection: never prune people entities
      if (doc.frontmatter.type === 'person') {
        protectedIds.push(memoryId);
        continue;
      }

      // Protection: never prune pinned items
      if (doc.frontmatter.pinned) {
        protectedIds.push(memoryId);
        continue;
      }

      // Protection: never prune items less than 14 days old
      const created = new Date(doc.frontmatter.created);
      const ageDays =
        (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < 14) {
        protectedIds.push(memoryId);
        continue;
      }

      // Attempt to archive
      let archived = false;
      if (
        doc.frontmatter.type === 'episode'
      ) {
        archived = this.store.archiveEpisode(memoryId);
      } else {
        archived = this.store.archiveEntity(memoryId);
      }

      if (archived) {
        archivedIds.push(memoryId);
      }
      prunedIds.push(memoryId);
    }

    this.db.logLifecycleAction('prune', {
      pruned: prunedIds.length,
      archived: archivedIds.length,
      protected: protectedIds.length,
    });

    return { prunedIds, archivedIds, protectedIds };
  }

  // --- Helper methods ---

  /**
   * Check if a lifecycle action is due based on the configured interval.
   */
  private isDue(action: string, interval: string, now: Date): boolean {
    const lastRun = this.db.getLastLifecycleAction(action);
    if (!lastRun) return true;

    const lastRunTime = new Date(lastRun).getTime();
    const intervalMs = this.parseInterval(interval);
    return now.getTime() - lastRunTime >= intervalMs;
  }

  /**
   * Parse an interval string like "24h", "48h", "7d" into milliseconds.
   */
  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)(h|d|m)$/);
    if (!match) return 24 * 60 * 60 * 1000; // default: 24h

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Cluster episodes by shared entities and content similarity.
   */
  private clusterEpisodes(
    episodes: EpisodeDocument[],
  ): EpisodeDocument[][] {
    const embedder = new LocalEmbedder();
    for (const ep of episodes) {
      embedder.indexDocument(ep.body);
    }

    const used = new Set<string>();
    const clusters: EpisodeDocument[][] = [];

    for (let i = 0; i < episodes.length; i++) {
      if (used.has(episodes[i].id)) continue;

      const cluster: EpisodeDocument[] = [episodes[i]];
      used.add(episodes[i].id);

      const iEntities = new Set(episodes[i].frontmatter.entities);
      const iEmbedding = embedder.embed(episodes[i].body);

      for (let j = i + 1; j < episodes.length; j++) {
        if (used.has(episodes[j].id)) continue;

        const jEntities = new Set(episodes[j].frontmatter.entities);
        const jEmbedding = embedder.embed(episodes[j].body);

        // Check entity overlap
        const entityOverlap = [...iEntities].filter((e) =>
          jEntities.has(e),
        ).length;

        // Check content similarity
        const similarity = LocalEmbedder.cosineSimilarity(
          iEmbedding,
          jEmbedding,
        );

        if (entityOverlap > 0 && similarity > 0.5) {
          cluster.push(episodes[j]);
          used.add(episodes[j].id);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  /**
   * Build a name for a consolidated episode.
   */
  private buildConsolidatedName(episodes: EpisodeDocument[]): string {
    // Use the most common entity as the topic
    const entityCounts = new Map<string, number>();
    for (const ep of episodes) {
      for (const entity of ep.frontmatter.entities) {
        entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
      }
    }

    let topEntity = 'various-topics';
    let topCount = 0;
    for (const [entity, count] of entityCounts) {
      if (count > topCount) {
        topEntity = entity;
        topCount = count;
      }
    }

    const dateRange = [
      episodes[0].frontmatter.date,
      episodes[episodes.length - 1].frontmatter.date,
    ];

    return `consolidated-${topEntity}-${dateRange[0]}-to-${dateRange[1]}`;
  }

  /**
   * Build a consolidated body from multiple episodes.
   */
  private buildConsolidatedBody(episodes: EpisodeDocument[]): string {
    const lines: string[] = [
      `Consolidated from ${episodes.length} episodes:\n`,
    ];

    for (const ep of episodes) {
      lines.push(`### ${ep.frontmatter.name} (${ep.frontmatter.date})`);
      // Include first paragraph or first 200 chars
      const firstParagraph = ep.body.split('\n\n')[0];
      lines.push(
        firstParagraph.length > 200
          ? firstParagraph.slice(0, 200) + '...'
          : firstParagraph,
      );
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Extract promotable facts from an episode body.
   * Looks for bullet points that state durable facts.
   */
  private extractPromotableFacts(episode: EpisodeDocument): string[] {
    const lines = episode.body.split('\n');
    const facts: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') && !trimmed.startsWith('- [')) {
        const fact = trimmed.slice(2);
        // Skip action items, questions, and short facts
        if (
          !fact.includes('?') &&
          !fact.startsWith('TODO') &&
          !fact.startsWith('Action:') &&
          fact.length > 10
        ) {
          facts.push(fact);
        }
      }
    }

    return facts;
  }

  /**
   * Append new facts to an entity's body.
   */
  private appendFacts(entity: EntityDocument, facts: string[]): string {
    let body = entity.body;

    // Find the History section to insert before it
    const historyIdx = body.indexOf('## History');
    const insertPoint = historyIdx >= 0 ? historyIdx : body.length;

    const factLines = facts.map((f) => `- ${f}`).join('\n');
    const insertion = `\n${factLines}\n\n`;

    body =
      body.slice(0, insertPoint).trimEnd() +
      insertion +
      body.slice(insertPoint);

    return body;
  }
}

/**
 * Exported heartbeat handler for the plugin hook.
 */
export async function onHeartbeat(context: {
  lifecycle: LifecycleManager;
}): Promise<void> {
  await context.lifecycle.onHeartbeat();
}
