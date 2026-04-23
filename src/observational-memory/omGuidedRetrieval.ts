/**
 * @file omGuidedRetrieval.ts
 * @description Step 17: OM-guided retrieval helpers. Parses the dual-path
 * OM observation log into per-session blocks, scores each session by
 * cosine similarity between its observation block embedding and the
 * question embedding, and selects the top-K candidate sessions.
 *
 * The candidate session set is then used to scope HybridRetriever (via
 * post-hoc filter on retrieved evidence) so the reader sees only chunks
 * from sessions the OM identified as relevant.
 *
 * @module agentos-bench/observational-memory/omGuidedRetrieval
 */

import type { IEmbeddingManager } from '@framers/agentos/core/embeddings/IEmbeddingManager';
import { extractObservationsBlock } from './runner.js';

/**
 * Minimal shape of an OM per-session observation batch consumed by the
 * Step 17 helpers. Matches `OmObservationBatch` from runner.ts but
 * loosened so callers can pass any compatible shape (e.g. test fixtures).
 */
export interface PerSessionBatchLike {
  sessionId: string;
  rawOutput: string;
}

/**
 * One session's relevance score for a question.
 */
export interface SessionScore {
  sessionId: string;
  score: number;
  observationText: string;
}

/**
 * Build a `sessionId → observation text` map from the per-session OM
 * observation batches produced by `ingestSessions` in dual-path or
 * per-session modes.
 *
 * Each batch's `rawOutput` is the observer's raw response, including
 * `<observations>...</observations>` and `<current-task>...</current-task>`
 * blocks. We extract just the `<observations>` content for relevance
 * scoring; if the tags are missing we fall back to the raw output.
 *
 * Skips batches with empty sessionId or empty observation text.
 *
 * Replaces the original v1 implementation that parsed the dual-path
 * finalLog string (broken because the actual `Date: ...` headers don't
 * include session IDs — the per-session pass uses dates as anchors).
 * Using batches directly avoids the date→sessionId mapping problem.
 */
export function extractPerSessionBlocks(
  perSessionBatches: readonly PerSessionBatchLike[],
): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const batch of perSessionBatches) {
    if (!batch.sessionId || !batch.rawOutput) continue;
    const extracted = extractObservationsBlock(batch.rawOutput) ?? batch.rawOutput;
    const trimmed = extracted.trim();
    if (trimmed.length === 0) continue;
    blocks.set(batch.sessionId, trimmed);
  }
  return blocks;
}

/**
 * Pick the top-K candidate sessions by descending score. Returns a Set
 * of sessionIds. When K >= scores.length, returns all sessions.
 */
export function pickCandidateSessions(scores: SessionScore[], K: number): Set<string> {
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  return new Set(sorted.slice(0, K).map((s) => s.sessionId));
}

/**
 * Compute cosine similarity between two unit-or-non-unit vectors.
 * Returns 0 when either vector is zero-length.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Arguments for {@link scoreSessionsByQueryRelevance}.
 */
export interface ScoreSessionsArgs {
  question: string;
  perSessionBlocks: Map<string, string>;
  embedder: IEmbeddingManager;
}

/**
 * Score each session's observation block by cosine similarity to the
 * question embedding. Returns sessions sorted by descending score.
 *
 * Embedding cost: 1 question call + N session-block calls. For typical
 * LongMemEval-S cases (N=50), ~$0.005 at text-embedding-3-small.
 */
export async function scoreSessionsByQueryRelevance(args: ScoreSessionsArgs): Promise<SessionScore[]> {
  const { question, perSessionBlocks, embedder } = args;
  if (perSessionBlocks.size === 0) return [];
  const sessionIds = Array.from(perSessionBlocks.keys());
  const blockTexts = sessionIds.map((id) => perSessionBlocks.get(id) ?? '');
  // Batch: question + all blocks in one call when supported.
  const allTexts = [question, ...blockTexts];
  const response = await embedder.generateEmbeddings({ texts: allTexts });
  const embeddings = response.embeddings;
  if (embeddings.length !== allTexts.length) {
    // Defensive: degraded mode if embedder returned partial results.
    return sessionIds.map((id, i) => ({
      sessionId: id,
      score: 0,
      observationText: blockTexts[i] ?? '',
    }));
  }
  const questionEmbedding = embeddings[0];
  const scores: SessionScore[] = sessionIds.map((sessionId, i) => ({
    sessionId,
    score: cosineSimilarity(questionEmbedding, embeddings[i + 1]),
    observationText: blockTexts[i],
  }));
  scores.sort((a, b) => b.score - a.score);
  return scores;
}
