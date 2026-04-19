/**
 * @file computeStratifiedAccuracy.ts
 * @description Stratified accuracy — weighted by upstream case-type priors.
 *
 * Priors are re-normalized over the types present in the run so a partial
 * sample (e.g. only `multi-session`) still produces a meaningful weighted
 * number without faking types that were not measured.
 *
 * @module agentos-bench/core/metrics/computeStratifiedAccuracy
 */

import type { CaseResult } from '../IBenchmark.js';

/**
 * Canonical LongMemEval-S case-type frequencies, computed exactly from
 * the shipped 500-case dataset (2026-04-19 snapshot). Snapshot-versioned:
 * if the upstream dataset regenerates with different type counts,
 * re-compute and bump the date comment.
 *
 * Verified via:
 *   node -e "const d=require('./data/longmemeval/longmemeval_s.json');
 *            const t={}; for (const c of d) t[c.question_type]=(t[c.question_type]||0)+1;
 *            console.log(t)"
 *
 * Counts:
 *   single-session-user:        70  (14.0%)
 *   single-session-assistant:   56  (11.2%)
 *   single-session-preference:  30  ( 6.0%)
 *   multi-session:             133  (26.6%)
 *   temporal-reasoning:        133  (26.6%)
 *   knowledge-update:           78  (15.6%)
 *   ---                        500
 */
export const LONGMEMEVAL_S_PRIORS: Record<string, number> = {
  'single-session-user':        0.140,
  'single-session-assistant':   0.112,
  'single-session-preference':  0.060,
  'multi-session':              0.266,
  'temporal-reasoning':         0.266,
  'knowledge-update':           0.156,
};

/**
 * Output of {@link computeStratifiedAccuracy}.
 */
export interface StratifiedAccuracy {
  /** Per-type accuracy and re-normalized prior used in the weighting. */
  byType: Record<string, { n: number; accuracy: number; prior: number }>;
  /** Σ (renormalized-prior_t × accuracy_t) over present types. */
  weightedOverall: number;
  /** passedCases / totalCases; matches today's `accuracy`. */
  unweightedOverall: number;
  /** Types in `priors` but absent from the run (diagnostic). */
  missingTypes: string[];
}

/**
 * Compute stratified accuracy from a list of scored cases.
 *
 * @param results  the per-case results from a benchmark run
 * @param priors   case-type → prior weight; when empty, falls back to
 *                 equal weighting across observed types (weighted ==
 *                 unweighted)
 */
export function computeStratifiedAccuracy(
  results: CaseResult[],
  priors: Record<string, number>,
): StratifiedAccuracy {
  if (results.length === 0) {
    return {
      byType: {},
      weightedOverall: 0,
      unweightedOverall: 0,
      missingTypes: Object.keys(priors),
    };
  }

  const groups = new Map<string, { n: number; passed: number }>();
  for (const r of results) {
    const caseType =
      ((r.metadata as Record<string, unknown> | undefined)?.caseType as string | undefined) ??
      'unknown';
    const g = groups.get(caseType) ?? { n: 0, passed: 0 };
    g.n += 1;
    if (r.passed) g.passed += 1;
    groups.set(caseType, g);
  }

  const hasRealPriors = Object.keys(priors).length > 0;
  const presentPriorsSum = hasRealPriors
    ? Array.from(groups.keys()).reduce((s, t) => s + (priors[t] ?? 0), 0)
    : 0;
  const useEqualWeight = !hasRealPriors || presentPriorsSum === 0;

  const byType: StratifiedAccuracy['byType'] = {};
  let weighted = 0;
  for (const [type, g] of groups) {
    const accuracy = g.passed / g.n;
    const normalizedPrior = useEqualWeight
      ? 1 / groups.size
      : (priors[type] ?? 0) / presentPriorsSum;
    byType[type] = { n: g.n, accuracy, prior: normalizedPrior };
    weighted += normalizedPrior * accuracy;
  }

  const totalPassed = results.filter((r) => r.passed).length;
  const unweighted = totalPassed / results.length;

  const missingTypes = Object.keys(priors).filter((t) => !groups.has(t));

  return {
    byType,
    weightedOverall: weighted,
    unweightedOverall: unweighted,
    missingTypes,
  };
}
