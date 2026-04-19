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
 * Retrieval-quality scorecard for one case. All rate fields are
 * normalised to [0, 1]; integer fields are diagnostic counts.
 *
 * Session-level semantics: gold is a set of haystack-session IDs
 * ("which sessions contain the answer"). Retrieved is a list of
 * chunks, each tagged with its source session. Multiple retrieved
 * chunks may share the same source session.
 *
 * - recallAtK = |unique gold sessions hit in top-K| / |gold|
 * - precisionAtK = |retrieved top-K chunks whose session is gold| / K
 *   (chunk-level — tells the reader how noisy the feed is)
 * - ndcgAtK = DCG / IDCG where DCG sums 1/log2(rank+1) over each
 *   unique gold session's FIRST rank in top-K (session-level NDCG,
 *   bounded in [0, 1])
 * - mrr = 1 / rank-of-first-gold-chunk (0 if no gold hit)
 */
export interface RetrievalMetrics {
  recallAtK: number;
  precisionAtK: number;
  ndcgAtK: number;
  mrr: number;
  k: number;
  goldCount: number;
  retrievedCount: number;
  /** Chunk-level: count of retrieved top-K chunks whose session is gold. */
  hits: number;
  /** Session-level: count of unique gold sessions that appeared in top-K. */
  goldSessionsHit: number;
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

  let chunkHits = 0;            // chunk-level: every top-K chunk in a gold session
  let firstHitRank = 0;         // 1-indexed rank of the first chunk-level hit
  const firstRankByGoldSession = new Map<string, number>();

  for (let i = 0; i < topK.length; i += 1) {
    const sid = topK[i];
    const relevant = sid !== undefined && gold.has(sid);
    if (relevant) {
      chunkHits += 1;
      if (firstHitRank === 0) firstHitRank = i + 1;
      if (!firstRankByGoldSession.has(sid)) {
        firstRankByGoldSession.set(sid, i + 1);
      }
    }
  }

  // Session-level DCG: each unique gold session contributes 1/log2(rank+1)
  // at the rank of its first chunk hit. Later chunks from the same gold
  // session add no new relevance — we already "recovered" that session.
  let dcg = 0;
  for (const rank of firstRankByGoldSession.values()) {
    dcg += 1 / Math.log2(rank + 1);
  }

  // IDCG: ideal ranks positions 1..min(|gold|, K). Each gold session hits
  // as early as possible.
  const idealHits = Math.min(goldSessionIds.length, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }

  const goldSessionsHit = firstRankByGoldSession.size;

  return {
    recallAtK: goldSessionsHit / goldSessionIds.length,
    precisionAtK: chunkHits / k,
    ndcgAtK: idcg === 0 ? 0 : dcg / idcg,
    mrr: firstHitRank === 0 ? 0 : 1 / firstHitRank,
    k,
    goldCount: goldSessionIds.length,
    retrievedCount: retrievedSessionIds.length,
    hits: chunkHits,
    goldSessionsHit,
  };
}
