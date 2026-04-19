/**
 * @file computeLatencyBreakdown.ts
 * @description Per-operation latency percentiles (p50/p95/p99) for
 * memory-stack operations. Reuses the existing `percentile` helper from
 * `statsUtil.ts`.
 *
 * @module agentos-bench/core/metrics/computeLatencyBreakdown
 */

import { percentile } from '../statsUtil.js';

/**
 * Raw per-operation samples collected during a run.
 *
 * - `encodeMs`       one entry per `encode()` call across all cases
 * - `retrieveMs`     one entry per case (cognitive `retrieve()` totalTime)
 * - `vectorSearchMs` one entry per case (`diagnostics.vectorSearchTimeMs`)
 * - `scoringMs`      one entry per case (`diagnostics.scoringTimeMs`)
 * - `replayMs`       one entry per case (haystack replay duration)
 */
export interface LatencyOpSamples {
  encodeMs: number[];
  retrieveMs: number[];
  vectorSearchMs: number[];
  scoringMs: number[];
  replayMs: number[];
}

export interface LatencyOpStats {
  p50: number;
  p95: number;
  p99: number;
  n: number;
}

export interface LatencyBreakdown {
  encode: LatencyOpStats;
  retrieve: LatencyOpStats;
  vectorSearch: LatencyOpStats;
  scoring: LatencyOpStats;
  replay: LatencyOpStats;
}

function statsFrom(samples: number[]): LatencyOpStats {
  if (samples.length === 0) return { p50: 0, p95: 0, p99: 0, n: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    n: sorted.length,
  };
}

/**
 * Convert per-operation sample arrays into p50/p95/p99 stats for each op.
 */
export function computeLatencyBreakdown(samples: LatencyOpSamples): LatencyBreakdown {
  return {
    encode: statsFrom(samples.encodeMs),
    retrieve: statsFrom(samples.retrieveMs),
    vectorSearch: statsFrom(samples.vectorSearchMs),
    scoring: statsFrom(samples.scoringMs),
    replay: statsFrom(samples.replayMs),
  };
}
