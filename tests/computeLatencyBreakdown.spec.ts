import { describe, it, expect } from 'vitest';
import { computeLatencyBreakdown } from '../src/core/metrics/computeLatencyBreakdown.js';

describe('computeLatencyBreakdown', () => {
  it('returns all-zero for empty samples', () => {
    const out = computeLatencyBreakdown({
      encodeMs: [],
      retrieveMs: [],
      vectorSearchMs: [],
      scoringMs: [],
      replayMs: [],
    });
    for (const op of ['encode', 'retrieve', 'vectorSearch', 'scoring', 'replay'] as const) {
      expect(out[op].n).toBe(0);
      expect(out[op].p50).toBe(0);
      expect(out[op].p95).toBe(0);
      expect(out[op].p99).toBe(0);
    }
  });

  it('p50 of [1..100] approximately 50.5', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const out = computeLatencyBreakdown({
      encodeMs: samples,
      retrieveMs: [],
      vectorSearchMs: [],
      scoringMs: [],
      replayMs: [],
    });
    expect(out.encode.p50).toBeCloseTo(50.5, 1);
    expect(out.encode.n).toBe(100);
  });

  it('p99 >= p95 >= p50 >= 0 (monotonicity)', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const out = computeLatencyBreakdown({
      encodeMs: samples,
      retrieveMs: samples,
      vectorSearchMs: samples,
      scoringMs: samples,
      replayMs: samples,
    });
    for (const op of ['encode', 'retrieve', 'vectorSearch', 'scoring', 'replay'] as const) {
      expect(out[op].p99).toBeGreaterThanOrEqual(out[op].p95);
      expect(out[op].p95).toBeGreaterThanOrEqual(out[op].p50);
      expect(out[op].p50).toBeGreaterThanOrEqual(0);
    }
  });

  it('single-value arrays produce constant percentiles', () => {
    const out = computeLatencyBreakdown({
      encodeMs: [42],
      retrieveMs: [],
      vectorSearchMs: [],
      scoringMs: [],
      replayMs: [],
    });
    expect(out.encode.p50).toBe(42);
    expect(out.encode.p95).toBe(42);
    expect(out.encode.p99).toBe(42);
    expect(out.encode.n).toBe(1);
  });

  it('reports n per operation independently', () => {
    const out = computeLatencyBreakdown({
      encodeMs: [1, 2, 3],
      retrieveMs: [10],
      vectorSearchMs: [],
      scoringMs: [100, 200],
      replayMs: [5, 5, 5, 5],
    });
    expect(out.encode.n).toBe(3);
    expect(out.retrieve.n).toBe(1);
    expect(out.vectorSearch.n).toBe(0);
    expect(out.scoring.n).toBe(2);
    expect(out.replay.n).toBe(4);
  });
});
