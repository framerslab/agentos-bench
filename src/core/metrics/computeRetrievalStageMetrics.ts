/**
 * @file computeRetrievalStageMetrics.ts
 * @description Per-stage Recall@K / Precision@K / NDCG@K / MRR for the
 * hybrid retrieval pipeline (dense → sparse → merged → reranked → final).
 * Splits what today is a single end-to-end metric so Step 9 and future
 * steps can see which stage is costing accuracy.
 *
 * The function is agnostic to whether the ranked IDs are trace IDs or
 * session IDs — the caller is expected to translate to whichever ID space
 * the `goldIds` set lives in before invoking. For LongMemEval the
 * benchmark adapter translates trace IDs to session IDs (since
 * `CaseResult.goldSessionIds` is the gold set).
 *
 * @module agentos-bench/core/metrics/computeRetrievalStageMetrics
 */

export type StageName = 'dense' | 'sparse' | 'merged' | 'reranked' | 'final';

export type StageRankedIds = Record<StageName, readonly string[]>;

export interface StageMetric {
  recallAtK: number;
  precisionAtK: number;
  ndcgAtK: number;
  mrr: number;
  k: number;
  goldCount: number;
}

export type RetrievalStageMetrics = Record<StageName, StageMetric>;

export function computeRetrievalStageMetrics(
  stages: StageRankedIds,
  goldIds: ReadonlySet<string>,
  k: number,
): RetrievalStageMetrics {
  const out = {} as RetrievalStageMetrics;
  for (const stage of ['dense', 'sparse', 'merged', 'reranked', 'final'] as const) {
    out[stage] = computeOne(stages[stage], goldIds, k);
  }
  return out;
}

function computeOne(
  ranked: readonly string[],
  goldIds: ReadonlySet<string>,
  k: number,
): StageMetric {
  const topK = ranked.slice(0, k);
  const goldCount = goldIds.size;

  if (goldCount === 0) {
    return { recallAtK: 0, precisionAtK: 0, ndcgAtK: 0, mrr: 0, k, goldCount: 0 };
  }

  let hits = 0;
  let firstHitRank = 0;
  let dcg = 0;
  const seen = new Set<string>();
  for (let i = 0; i < topK.length; i++) {
    const id = topK[i]!;
    if (seen.has(id)) continue; // de-dupe repeated IDs (possible after trace→session mapping)
    seen.add(id);
    if (goldIds.has(id)) {
      hits++;
      if (firstHitRank === 0) firstHitRank = i + 1;
      dcg += 1 / Math.log2(i + 2);
    }
  }
  const idealHits = Math.min(k, goldCount);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);

  return {
    recallAtK: hits / goldCount,
    precisionAtK: topK.length > 0 ? hits / topK.length : 0,
    ndcgAtK: idcg > 0 ? dcg / idcg : 0,
    mrr: firstHitRank > 0 ? 1 / firstHitRank : 0,
    k,
    goldCount,
  };
}
