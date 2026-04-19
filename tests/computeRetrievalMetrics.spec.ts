import { describe, it, expect } from 'vitest';
import { computeRetrievalMetrics } from '../src/core/metrics/computeRetrievalMetrics.js';

describe('computeRetrievalMetrics', () => {
  it('returns null when goldSessionIds is empty', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: [],
      retrievedSessionIds: ['A', 'B'],
      k: 10,
    });
    expect(r).toBeNull();
  });

  it('scores perfect retrieval (gold at rank 1) with full recall + MRR=1', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A'],
      retrievedSessionIds: ['A', 'B', 'C'],
      k: 3,
    });
    expect(r).not.toBeNull();
    expect(r!.recallAtK).toBe(1);
    expect(r!.mrr).toBe(1);
    expect(r!.precisionAtK).toBeCloseTo(1 / 3, 6);
    expect(r!.hits).toBe(1);
    expect(r!.goldSessionsHit).toBe(1);
  });

  it('caps recallAtK at 1 when multiple chunks from the same gold session appear', () => {
    // Regression: before session-level fix, this returned recallAtK > 1
    // because chunkHits (=10) was divided by goldCount (=1).
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A'],
      retrievedSessionIds: ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'],
      k: 10,
    });
    expect(r!.recallAtK).toBe(1);
    expect(r!.precisionAtK).toBe(1); // chunk-level: 10/10
    expect(r!.ndcgAtK).toBe(1);
    expect(r!.goldSessionsHit).toBe(1);
    expect(r!.hits).toBe(10);
  });

  it('ndcgAtK stays bounded [0, 1] when chunks duplicate a gold session', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A', 'B'],
      retrievedSessionIds: ['A', 'A', 'A', 'B', 'A'],
      k: 5,
    });
    expect(r!.ndcgAtK).toBeGreaterThanOrEqual(0);
    expect(r!.ndcgAtK).toBeLessThanOrEqual(1);
    expect(r!.recallAtK).toBe(1); // both A and B hit
    expect(r!.goldSessionsHit).toBe(2);
  });

  it('matches hand-computed NDCG@4 for gold=[A,B], retrieved=[A,C,B,D]', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A', 'B'],
      retrievedSessionIds: ['A', 'C', 'B', 'D'],
      k: 4,
    });
    // DCG = 1/log2(2) + 1/log2(4) = 1 + 0.5 = 1.5
    // IDCG = 1/log2(2) + 1/log2(3) = 1 + 0.6309 = 1.6309
    // NDCG = 1.5 / 1.6309 = 0.9197
    expect(r!.ndcgAtK).toBeCloseTo(0.9197, 3);
  });

  it('returns MRR=1/3 when first gold appears at rank 3', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['X'],
      retrievedSessionIds: ['A', 'B', 'X', 'C'],
      k: 4,
    });
    expect(r!.mrr).toBeCloseTo(1 / 3, 6);
  });

  it('returns MRR=0 when no gold is retrieved', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['X'],
      retrievedSessionIds: ['A', 'B', 'C'],
      k: 3,
    });
    expect(r!.mrr).toBe(0);
    expect(r!.recallAtK).toBe(0);
    expect(r!.hits).toBe(0);
  });

  it('handles K > retrieved length (no padding)', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A'],
      retrievedSessionIds: ['A'],
      k: 10,
    });
    expect(r!.recallAtK).toBe(1);
    expect(r!.precisionAtK).toBeCloseTo(1 / 10, 6);
    expect(r!.retrievedCount).toBe(1);
  });

  it('ignores undefined entries in retrievedSessionIds (untagged traces)', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A'],
      retrievedSessionIds: [undefined, 'A', undefined],
      k: 3,
    });
    expect(r!.hits).toBe(1);
    expect(r!.mrr).toBeCloseTo(1 / 2, 6);
  });

  it('truncates retrieved to K when longer', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['Z'],
      retrievedSessionIds: ['A', 'B', 'C', 'Z'],
      k: 2,
    });
    expect(r!.hits).toBe(0);
    expect(r!.recallAtK).toBe(0);
  });

  it('produces precision=recall=1 when gold fully covers top-K with no miss', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A', 'B'],
      retrievedSessionIds: ['A', 'B'],
      k: 2,
    });
    expect(r!.recallAtK).toBe(1);
    expect(r!.precisionAtK).toBe(1);
    expect(r!.ndcgAtK).toBeCloseTo(1, 6);
    expect(r!.mrr).toBe(1);
  });

  it('returns all-zero metrics (non-null) when gold present but retrieved is empty', () => {
    const r = computeRetrievalMetrics({
      goldSessionIds: ['A'],
      retrievedSessionIds: [],
      k: 10,
    });
    expect(r).not.toBeNull();
    expect(r!.recallAtK).toBe(0);
    expect(r!.precisionAtK).toBe(0);
    expect(r!.ndcgAtK).toBe(0);
    expect(r!.mrr).toBe(0);
    expect(r!.hits).toBe(0);
    expect(r!.retrievedCount).toBe(0);
  });
});
