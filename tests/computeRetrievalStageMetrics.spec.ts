/**
 * @file computeRetrievalStageMetrics.spec.ts
 * @description Regression tests for per-stage Recall@K / NDCG@K / MRR
 * for the hybrid retrieval pipeline (dense → sparse → merged → reranked → final).
 */

import { describe, it, expect } from 'vitest';
import {
  computeRetrievalStageMetrics,
  type StageRankedIds,
} from '../src/core/metrics/computeRetrievalStageMetrics.js';

describe('computeRetrievalStageMetrics', () => {
  it('returns recall@K=1 when all gold IDs are in top-K', () => {
    const stages: StageRankedIds = {
      dense: ['a', 'b', 'c', 'd', 'e'],
      sparse: ['a', 'b', 'c'],
      merged: ['a', 'b', 'c', 'd'],
      reranked: ['a', 'b', 'c', 'd'],
      final: ['a', 'b', 'c', 'd'],
    };
    const goldIds = new Set(['a', 'b']);
    const m = computeRetrievalStageMetrics(stages, goldIds, 5);
    expect(m.dense.recallAtK).toBe(1);
    expect(m.final.recallAtK).toBe(1);
  });

  it('reports recall=0 for a stage that misses the gold completely', () => {
    const stages: StageRankedIds = {
      dense: ['x', 'y', 'z'],
      sparse: ['a'],
      merged: ['x', 'y', 'z', 'a'],
      reranked: ['a', 'x', 'y', 'z'],
      final: ['a'],
    };
    const m = computeRetrievalStageMetrics(stages, new Set(['a']), 3);
    expect(m.dense.recallAtK).toBe(0);
    expect(m.final.recallAtK).toBe(1);
  });

  it('computes MRR using earliest rank', () => {
    const stages: StageRankedIds = {
      dense: ['x', 'a', 'b'],
      sparse: ['a'],
      merged: ['a', 'x', 'b'],
      reranked: ['a', 'x', 'b'],
      final: ['a'],
    };
    const m = computeRetrievalStageMetrics(stages, new Set(['a']), 3);
    expect(m.dense.mrr).toBeCloseTo(0.5, 3); // rank 2 → 1/2
    expect(m.merged.mrr).toBe(1);
  });

  it('returns zeros when goldIds is empty', () => {
    const stages: StageRankedIds = {
      dense: ['a', 'b'],
      sparse: [],
      merged: ['a', 'b'],
      reranked: ['a', 'b'],
      final: ['a', 'b'],
    };
    const m = computeRetrievalStageMetrics(stages, new Set(), 3);
    expect(m.dense.recallAtK).toBe(0);
    expect(m.dense.mrr).toBe(0);
  });

  it('caps NDCG ideal DCG at min(K, goldCount)', () => {
    const stages: StageRankedIds = {
      dense: ['a', 'b', 'c', 'd'],
      sparse: [],
      merged: ['a', 'b', 'c', 'd'],
      reranked: ['a', 'b', 'c', 'd'],
      final: ['a', 'b'],
    };
    const m = computeRetrievalStageMetrics(stages, new Set(['a', 'b', 'c', 'd']), 2);
    expect(m.final.ndcgAtK).toBeCloseTo(1, 3);
  });
});
