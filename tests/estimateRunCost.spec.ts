/**
 * @file estimateRunCost.spec.ts
 * @description Specification for {@link estimateRunCost} — the cost
 * preflight helper called before a benchmark run actually issues any
 * LLM calls.
 *
 * The estimate is intentionally coarse — it exists to prevent the
 * "oh no I ran LongMemEval-S with Opus 4.7 by mistake" class of
 * accidents, not to match actual spend to the penny. Keys we do care
 * about:
 *
 *   - Memory-less haystack-in-context is the most expensive path
 *     (115k tokens × N cases at reader price).
 *   - base-memory / full-cognitive only stuff a small retrieved-memory
 *     context into the reader, so estimates drop by ~20x.
 *   - External benchmarks add a judge call per case.
 *   - Micro-benchmarks cost $0 — no LLM calls.
 *   - The estimate must honour the `sampleN` knob.
 */

import { describe, it, expect } from 'vitest';

import { estimateRunCost } from '../src/core/estimateRunCost.js';

describe('estimateRunCost', () => {
  it('returns $0 for micro-benchmarks regardless of reader or case count', () => {
    const est = estimateRunCost({
      benchmarkId: 'decay-fidelity',
      family: 'micro',
      caseCount: 5,
      reader: 'claude-opus-4-7',
      judgeModel: 'gpt-4o',
      memoryMode: 'none',
    });
    expect(est.totalUsd).toBe(0);
    expect(est.reasoning).toMatch(/micro/i);
  });

  it('counts a large haystack for memoryMode=none and scales with caseCount', () => {
    const oneCase = estimateRunCost({
      benchmarkId: 'longmemeval-s',
      family: 'external',
      caseCount: 1,
      reader: 'claude-sonnet-4-6',
      judgeModel: 'gpt-4o',
      memoryMode: 'none',
    });
    const tenCases = estimateRunCost({
      benchmarkId: 'longmemeval-s',
      family: 'external',
      caseCount: 10,
      reader: 'claude-sonnet-4-6',
      judgeModel: 'gpt-4o',
      memoryMode: 'none',
    });
    expect(oneCase.totalUsd).toBeGreaterThan(0);
    // Linear scaling within a factor of 2 (constant overhead may be non-zero).
    expect(tenCases.totalUsd).toBeGreaterThan(8 * oneCase.totalUsd);
    expect(tenCases.totalUsd).toBeLessThan(12 * oneCase.totalUsd);
  });

  it('memory-backed runs cost dramatically less than none-memory runs', () => {
    const baseArgs = {
      benchmarkId: 'longmemeval-s',
      family: 'external' as const,
      caseCount: 20,
      reader: 'claude-sonnet-4-6',
      judgeModel: 'gpt-4o',
    };
    const noneCost = estimateRunCost({ ...baseArgs, memoryMode: 'none' }).totalUsd;
    const baseCost = estimateRunCost({ ...baseArgs, memoryMode: 'base-memory' }).totalUsd;
    const cogCost = estimateRunCost({ ...baseArgs, memoryMode: 'full-cognitive' }).totalUsd;
    // Memory modes shrink the reader's input context by ~20x; the
    // estimate must reflect that or the preflight is useless.
    expect(baseCost).toBeLessThan(noneCost / 5);
    expect(cogCost).toBeLessThan(noneCost / 5);
  });

  it('sampleN clamps the case count', () => {
    const full = estimateRunCost({
      benchmarkId: 'longmemeval-s',
      family: 'external',
      caseCount: 500,
      reader: 'claude-sonnet-4-6',
      judgeModel: 'gpt-4o',
      memoryMode: 'none',
    });
    const sampled = estimateRunCost({
      benchmarkId: 'longmemeval-s',
      family: 'external',
      caseCount: 500,
      sampleN: 10,
      reader: 'claude-sonnet-4-6',
      judgeModel: 'gpt-4o',
      memoryMode: 'none',
    });
    expect(sampled.effectiveCaseCount).toBe(10);
    expect(sampled.totalUsd).toBeLessThan(full.totalUsd / 40);
  });

  it('Opus 4.7 costs ~5x more than Sonnet 4.6 for the same run', () => {
    const args = {
      benchmarkId: 'longmemeval-s',
      family: 'external' as const,
      caseCount: 50,
      judgeModel: 'gpt-4o',
      memoryMode: 'none' as const,
    };
    const sonnet = estimateRunCost({ ...args, reader: 'claude-sonnet-4-6' }).totalUsd;
    const opus = estimateRunCost({ ...args, reader: 'claude-opus-4-7' }).totalUsd;
    // Sonnet $0.003/1k prompt vs Opus $0.015/1k — the ratio is 5x.
    expect(opus / sonnet).toBeGreaterThan(4);
    expect(opus / sonnet).toBeLessThan(6);
  });

  it('returns a non-negative estimate for unknown models (warns, does not throw)', () => {
    const est = estimateRunCost({
      benchmarkId: 'longmemeval-s',
      family: 'external',
      caseCount: 10,
      reader: 'not-a-real-model' as never,
      judgeModel: 'gpt-4o',
      memoryMode: 'none',
    });
    expect(est.totalUsd).toBeGreaterThanOrEqual(0);
    expect(est.warnings.length).toBeGreaterThan(0);
  });
});
