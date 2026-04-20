/**
 * @file computeBootstrapCI.ts
 * @description Generic percentile-bootstrap confidence interval for any
 * scalar statistic over a sample.
 *
 * ## What this does
 *
 * Given a sample of values and a function that reduces a sample to a
 * scalar (e.g. accuracy, weighted accuracy, median latency), compute the
 * point estimate plus a bootstrap-resampled confidence interval. The
 * percentile method is used: the lower and upper bounds come directly
 * from the `(1-ci)/2` and `(1+ci)/2` percentiles of the bootstrap
 * distribution.
 *
 * ## Why percentile (not BCa)
 *
 * Bench accuracy statistics live in [0, 1] and we almost never operate
 * at the 0/1 boundaries where bias-corrected-and-accelerated (BCa)
 * correction matters most. Percentile is simple, defensible, and stays
 * readable in downstream findings docs. Swap to BCa later if a step's
 * true metric lives near a boundary.
 *
 * ## Determinism
 *
 * Pass `options.seed` to get byte-identical CIs across runs. The seedable
 * PRNG is Mulberry32 (32-bit state; plenty for 10k-100k resamples). When
 * `seed` is undefined, `Math.random` is used.
 *
 * ## Cost
 *
 * Pure CPU. For N=200 cases * 10,000 resamples * O(N) statistic, total
 * work is ~2M statistic evaluations, under 2 seconds on a modern
 * laptop. No API calls.
 *
 * ## Motivation
 *
 * Per {@link https://arxiv.org/abs/2603.28769 Spark-LLM-Eval} and the
 * {@link https://www.nist.gov/news-events/news/2026/02/new-report-expanding-ai-evaluation-toolbox-statistical-models NIST Feb 2026 evaluation-toolbox report},
 * LLM benchmark comparisons without confidence intervals cannot
 * distinguish genuine improvements from sample noise. The Penfield Labs
 * LoCoMo audit (Apr 2026) shows a judge-noise floor around 63 percent
 * for topically-adjacent wrong answers; our CI gating makes sure step-
 * level claims sit outside that floor.
 *
 * @module agentos-bench/core/metrics/computeBootstrapCI
 */

/**
 * Result of a bootstrap CI computation.
 */
export interface BootstrapResult {
  /** Point estimate: the statistic on the original (un-resampled) sample. */
  value: number;
  /** Lower bound of the confidence interval. */
  ciLo: number;
  /** Upper bound of the confidence interval. */
  ciHi: number;
  /** Number of bootstrap resamples drawn. Zero when input has <= 1 element. */
  resamples: number;
  /** The CI level used (e.g. 0.95). */
  ci: number;
}

/**
 * Options for {@link computeBootstrapCI}.
 */
export interface BootstrapOptions {
  /** Bootstrap resample count. Default 10,000. */
  resamples?: number;
  /** Confidence level in (0, 1). Default 0.95. */
  ci?: number;
  /**
   * Optional seed for deterministic CIs. When omitted, uses
   * {@link Math.random}; callers that need reproducibility (findings
   * docs, regression tests) should always pass a seed.
   */
  seed?: number;
}

/**
 * Mulberry32 — small, fast 32-bit seedable PRNG. Adequate for bootstrap
 * resampling where per-draw independence matters but cryptographic
 * quality does not.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute a percentile-bootstrap confidence interval for an arbitrary
 * scalar statistic over a sample.
 *
 * @typeParam T - element type of the input sample (commonly `number`,
 *                sometimes `CaseResult` for benchmark-level aggregates).
 * @param values - the sample to resample. Must be non-empty.
 * @param statistic - reduces a bootstrap sample to a scalar. Called once
 *                    on `values` for the point estimate, then once per
 *                    resample.
 * @param options - {@link BootstrapOptions}. See individual fields for
 *                  defaults.
 * @returns a {@link BootstrapResult} with point estimate and CI bounds.
 *
 * @throws when `values` is empty.
 *
 * @example
 * ```ts
 * const passes = cases.map((c) => (c.passed ? 1 : 0));
 * const accuracy = computeBootstrapCI(
 *   passes,
 *   (s) => s.reduce((a, b) => a + b, 0) / s.length,
 *   { seed: 42, resamples: 10_000, ci: 0.95 },
 * );
 * // => { value: 0.853, ciLo: 0.775, ciHi: 0.922, resamples: 10000, ci: 0.95 }
 * ```
 */
export function computeBootstrapCI<T>(
  values: T[],
  statistic: (sample: T[]) => number,
  options: BootstrapOptions = {},
): BootstrapResult {
  if (values.length === 0) {
    throw new Error('computeBootstrapCI: values must not be empty');
  }
  const resamples = options.resamples ?? 10_000;
  const ci = options.ci ?? 0.95;
  if (ci <= 0 || ci >= 1) {
    throw new Error(`computeBootstrapCI: ci must be in (0, 1), got ${ci}`);
  }
  const rand = options.seed !== undefined ? mulberry32(options.seed) : Math.random;

  const point = statistic(values);

  // A single-element sample has no sampling variance to estimate.
  // Collapse the CI to a point; keep the result shape uniform for
  // downstream aggregation.
  if (values.length === 1) {
    return { value: point, ciLo: point, ciHi: point, resamples: 0, ci };
  }

  const n = values.length;
  const stats: number[] = new Array(resamples);
  const sample: T[] = new Array(n);
  for (let r = 0; r < resamples; r += 1) {
    for (let i = 0; i < n; i += 1) {
      sample[i] = values[Math.floor(rand() * n)];
    }
    stats[r] = statistic(sample);
  }

  stats.sort((a, b) => a - b);
  const alpha = (1 - ci) / 2;
  // Percentile method: take the alpha-quantile and (1-alpha)-quantile of
  // the bootstrap distribution directly. Clamp to valid indices so a
  // very small `resamples` doesn't produce out-of-bounds reads.
  const loIdx = Math.min(resamples - 1, Math.max(0, Math.floor(alpha * resamples)));
  const hiIdx = Math.min(
    resamples - 1,
    Math.max(0, Math.ceil((1 - alpha) * resamples) - 1),
  );

  return { value: point, ciLo: stats[loIdx], ciHi: stats[hiIdx], resamples, ci };
}
