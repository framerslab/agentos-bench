/**
 * @file computeTokenEfficiency.ts
 * @description Tokens per correct answer, per CostTracker category.
 *
 * Surfaces the efficiency story: "for every correct answer AgentOS
 * produced, how many tokens of reader / judge / embedding work did we
 * burn?". Survives price changes (unlike cost/correct).
 *
 * @module agentos-bench/core/metrics/computeTokenEfficiency
 */

import type { CostTracker, CostCategory } from '../CostTracker.js';

export interface TokensPerCorrect {
  readerIn: number;
  readerOut: number;
  judgeIn: number;
  judgeOut: number;
  embeddingIn: number;
  total: number;
  /** True when passedCases was 0 and all values were forced to 0. */
  zeroPassedFallback?: boolean;
}

/**
 * Divide the CostTracker's aggregate token counts by passed cases.
 * Zero passed cases falls through as an explicit zero-filled result
 * with `zeroPassedFallback: true` so callers can render "not measured"
 * rather than infinity.
 */
export function computeTokenEfficiency(
  costTracker: CostTracker,
  passedCases: number,
): TokensPerCorrect {
  if (passedCases <= 0) {
    return {
      readerIn: 0,
      readerOut: 0,
      judgeIn: 0,
      judgeOut: 0,
      embeddingIn: 0,
      total: 0,
      zeroPassedFallback: true,
    };
  }
  const cats = costTracker.byCategory;
  const pick = (c: CostCategory, key: 'totalTokensIn' | 'totalTokensOut'): number =>
    (cats[c]?.[key] ?? 0) / passedCases;
  const readerIn = pick('reader', 'totalTokensIn');
  const readerOut = pick('reader', 'totalTokensOut');
  const judgeIn = pick('judge', 'totalTokensIn');
  const judgeOut = pick('judge', 'totalTokensOut');
  const embeddingIn = pick('embedding', 'totalTokensIn');
  return {
    readerIn,
    readerOut,
    judgeIn,
    judgeOut,
    embeddingIn,
    total: readerIn + readerOut + judgeIn + judgeOut + embeddingIn,
  };
}
