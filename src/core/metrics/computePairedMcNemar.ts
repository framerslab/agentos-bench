/**
 * @file computePairedMcNemar.ts
 * @description Paired McNemar's test for comparing two benchmark runs over
 * the same case set. Produces a chi-squared statistic with Yates continuity
 * correction and a two-sided p-value, giving blog-grade significance
 * claims for run-to-run deltas. Uses the chi-squared(df=1) upper-tail
 * CDF via the complementary error function — closed-form at df=1.
 *
 * @module agentos-bench/core/metrics/computePairedMcNemar
 */

import type { BenchResult } from '../IBenchmark.js';

export interface McNemarResult {
  /** Paired cases where A passed AND B failed. */
  bCount: number;
  /** Paired cases where A failed AND B passed. */
  cCount: number;
  /** Count of caseIds present in both runs. */
  totalPaired: number;
  /** Chi-squared statistic with Yates continuity correction. */
  statistic: number;
  /** Two-sided p-value from chi-squared with df=1. */
  pValue: number;
  /** True when pValue < 0.05. */
  significant: boolean;
}

/**
 * Compute McNemar's test statistic + p-value on two paired runs.
 *
 * Pairs cases by caseId. Only cases present in both runs contribute.
 * Correctness uses {@link CaseResult.passed} — the benchmark's canonical
 * pass/fail threshold, matching the `compareRuns` convention.
 *
 * Returns `{ bCount: 0, cCount: 0, statistic: 0, pValue: 1, significant: false }`
 * when no discordant pairs exist (degenerate case).
 */
export function computePairedMcNemar(a: BenchResult, b: BenchResult): McNemarResult {
  const aCases = new Map<string, boolean>();
  for (const c of a.cases ?? []) aCases.set(c.caseId, c.passed);
  const bCases = new Map<string, boolean>();
  for (const c of b.cases ?? []) bCases.set(c.caseId, c.passed);

  let bCount = 0;
  let cCount = 0;
  let totalPaired = 0;
  for (const [caseId, aPass] of aCases) {
    const bPass = bCases.get(caseId);
    if (bPass === undefined) continue;
    totalPaired++;
    if (aPass && !bPass) bCount++;
    else if (!aPass && bPass) cCount++;
  }

  const discordant = bCount + cCount;
  if (discordant === 0) {
    return {
      bCount,
      cCount,
      totalPaired,
      statistic: 0,
      pValue: 1,
      significant: false,
    };
  }

  const statistic = Math.pow(Math.abs(bCount - cCount) - 1, 2) / discordant;
  const pValue = chiSquaredSurvivalDf1(statistic);
  return {
    bCount,
    cCount,
    totalPaired,
    statistic,
    pValue,
    significant: pValue < 0.05,
  };
}

/**
 * Upper-tail chi-squared CDF at x with df=1. Closed-form via erfc:
 * P(chi2_1 > x) = erfc(sqrt(x/2)) for x >= 0.
 */
function chiSquaredSurvivalDf1(x: number): number {
  if (x <= 0) return 1;
  return erfc(Math.sqrt(x / 2));
}

/**
 * Complementary error function via Chebyshev approximation from Numerical
 * Recipes in C, §6.2. Max relative error ~1.2e-7 — well within p-value
 * reporting precision for significance testing.
 */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const poly =
    -1.26551223 +
    t *
      (1.00002368 +
        t *
          (0.37409196 +
            t *
              (0.09678418 +
                t *
                  (-0.18628806 +
                    t *
                      (0.27886807 +
                        t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const ans = t * Math.exp(-z * z + poly);
  return x >= 0 ? ans : 2 - ans;
}
