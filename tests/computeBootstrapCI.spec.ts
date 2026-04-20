import { describe, it, expect } from 'vitest';
import { computeBootstrapCI } from '../src/core/metrics/computeBootstrapCI.js';

describe('computeBootstrapCI', () => {
  it('throws on empty input', () => {
    expect(() => computeBootstrapCI([], (s) => s.length)).toThrowError(
      /must not be empty/i,
    );
  });

  it('returns point estimate with zero-width CI on a single value', () => {
    const r = computeBootstrapCI([0.7], (s) => s.reduce((a, b) => a + b, 0) / s.length);
    expect(r.value).toBeCloseTo(0.7, 10);
    expect(r.ciLo).toBeCloseTo(0.7, 10);
    expect(r.ciHi).toBeCloseTo(0.7, 10);
    expect(r.resamples).toBe(0);
    expect(r.ci).toBe(0.95);
  });

  it('is deterministic with seed', () => {
    const values = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0];
    const mean = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;
    const a = computeBootstrapCI(values, mean, { seed: 42, resamples: 500 });
    const b = computeBootstrapCI(values, mean, { seed: 42, resamples: 500 });
    expect(a.ciLo).toBeCloseTo(b.ciLo, 10);
    expect(a.ciHi).toBeCloseTo(b.ciHi, 10);
  });

  it('produces CI that contains the true mean with high coverage on a large sample', () => {
    const rng = (seed: number) => {
      let a = seed;
      return () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 2 ** 32;
      };
    };
    const rand = rng(123);
    const trueMean = 0.75;
    const values: number[] = [];
    for (let i = 0; i < 200; i++) values.push(rand() < trueMean ? 1 : 0);
    const r = computeBootstrapCI(
      values,
      (s) => s.reduce((a, b) => a + b, 0) / s.length,
      { seed: 7, resamples: 2000, ci: 0.95 },
    );
    expect(r.value).toBeGreaterThan(0.65);
    expect(r.value).toBeLessThan(0.85);
    expect(r.ciLo).toBeLessThanOrEqual(trueMean);
    expect(r.ciHi).toBeGreaterThanOrEqual(trueMean);
    expect(r.ciHi - r.ciLo).toBeLessThan(0.2);
  });

  it('honours custom ci level', () => {
    const values = [0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1];
    const mean = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;
    const r50 = computeBootstrapCI(values, mean, { seed: 1, resamples: 1000, ci: 0.5 });
    const r95 = computeBootstrapCI(values, mean, { seed: 1, resamples: 1000, ci: 0.95 });
    // Wider CI should span more.
    expect(r95.ciHi - r95.ciLo).toBeGreaterThan(r50.ciHi - r50.ciLo);
  });

  it('supports arbitrary statistic (not just mean)', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const median = (s: number[]) => {
      const sorted = [...s].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    };
    const r = computeBootstrapCI(values, median, { seed: 5, resamples: 500 });
    expect(r.value).toBe(5.5);
    expect(r.ciLo).toBeGreaterThanOrEqual(1);
    expect(r.ciHi).toBeLessThanOrEqual(10);
  });
});
