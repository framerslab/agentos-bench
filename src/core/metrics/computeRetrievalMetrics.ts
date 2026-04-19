/**
 * @file computeRetrievalMetrics.ts
 * @description Session-level retrieval-quality metrics (Recall@K, Precision@K,
 * NDCG@K, MRR) against a per-case gold set.
 *
 * Binary relevance: a retrieved item is relevant iff its source session
 * is in the gold set. NDCG uses the standard log-base-2 discount.
 *
 * @module agentos-bench/core/metrics/computeRetrievalMetrics
 */

/**
 * Inputs for computing session-level retrieval metrics for one case.
 */
export interface RetrievalMetricsInput {
  /** Gold session IDs for the case (from `case.metadata.answerSessionIds`). */
  goldSessionIds: string[];
  /**
   * Source session IDs of the retrieved items, in rank order. Entries may be
   * `undefined` when a retrieved trace carries no `bench-session:` tag.
   */
  retrievedSessionIds: (string | undefined)[];
  /** K for Recall/Precision/NDCG. */
  k: number;
}

/**
 * Retrieval-quality scorecard for one case. All fields are normalised
 * to [0, 1] or are integer counts for diagnostics.
 */
export interface RetrievalMetrics {
  recallAtK: number;
  precisionAtK: number;
  ndcgAtK: number;
  mrr: number;
  k: number;
  goldCount: number;
  retrievedCount: number;
  hits: number;
}

/**
 * Compute session-level retrieval metrics for one case.
 *
 * Returns `null` when `goldSessionIds` is empty — such cases must be
 * excluded from aggregate means so the denominator is honest.
 */
export function computeRetrievalMetrics(
  input: RetrievalMetricsInput,
): RetrievalMetrics | null {
  const { goldSessionIds, retrievedSessionIds, k } = input;
  if (goldSessionIds.length === 0) return null;

  const gold = new Set(goldSessionIds);
  const topK = retrievedSessionIds.slice(0, k);

  let hits = 0;
  let firstHitRank = 0;
  let dcg = 0;
  for (let i = 0; i < topK.length; i += 1) {
    const sid = topK[i];
    const relevant = sid !== undefined && gold.has(sid);
    if (relevant) {
      hits += 1;
      if (firstHitRank === 0) firstHitRank = i + 1;
      // 1-indexed rank; discount = 1 / log2(rank + 1).
      dcg += 1 / Math.log2(i + 2);
    }
  }

  const idealHits = Math.min(goldSessionIds.length, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }

  return {
    recallAtK: hits / goldSessionIds.length,
    precisionAtK: hits / k,
    ndcgAtK: idcg === 0 ? 0 : dcg / idcg,
    mrr: firstHitRank === 0 ? 0 : 1 / firstHitRank,
    k,
    goldCount: goldSessionIds.length,
    retrievedCount: retrievedSessionIds.length,
    hits,
  };
}
