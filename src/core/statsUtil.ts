/**
 * @file statsUtil.ts
 * @description Small statistics helpers used by benchmark aggregation.
 *
 * Factored here so each {@link IBenchmark} implementation does not
 * repeat the same percentile / stddev code.
 *
 * @module agentos-bench/core/statsUtil
 */

/**
 * Return the pth percentile of an already-sorted ascending array.
 * Returns 0 for empty input. Uses linear interpolation between adjacent
 * ranks (Type 7 / NumPy default).
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/**
 * Sample standard deviation. Returns 0 for arrays with fewer than two values.
 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Arithmetic mean. Returns 0 for empty input. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
