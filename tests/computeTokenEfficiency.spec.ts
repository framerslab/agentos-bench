import { describe, it, expect } from 'vitest';
import { computeTokenEfficiency } from '../src/core/metrics/computeTokenEfficiency.js';
import { CostTracker } from '../src/core/CostTracker.js';

describe('computeTokenEfficiency', () => {
  it('divides by passedCases', () => {
    const t = new CostTracker();
    t.record({ category: 'reader', model: 'gpt-4o', tokensIn: 1000, tokensOut: 100 });
    t.record({ category: 'judge', model: 'gpt-4o', tokensIn: 200, tokensOut: 20 });
    const out = computeTokenEfficiency(t, 10);
    expect(out.readerIn).toBe(100);
    expect(out.readerOut).toBe(10);
    expect(out.judgeIn).toBe(20);
    expect(out.judgeOut).toBe(2);
    expect(out.total).toBe((1000 + 100 + 200 + 20) / 10);
  });

  it('returns zeros and a diagnostic flag when passedCases == 0', () => {
    const t = new CostTracker();
    t.record({ category: 'reader', model: 'gpt-4o', tokensIn: 1000, tokensOut: 100 });
    const out = computeTokenEfficiency(t, 0);
    expect(out.readerIn).toBe(0);
    expect(out.readerOut).toBe(0);
    expect(out.total).toBe(0);
    expect(out.zeroPassedFallback).toBe(true);
  });

  it('handles embedding-only spend', () => {
    const t = new CostTracker();
    t.record({
      category: 'embedding',
      model: 'text-embedding-3-small',
      tokensIn: 500,
      tokensOut: 0,
    });
    const out = computeTokenEfficiency(t, 5);
    expect(out.embeddingIn).toBe(100);
    expect(out.readerIn).toBe(0);
  });

  it('total includes every category', () => {
    const t = new CostTracker();
    t.record({ category: 'reader', model: 'gpt-4o', tokensIn: 10, tokensOut: 10 });
    t.record({ category: 'embedding', model: 'text-embedding-3-small', tokensIn: 10, tokensOut: 0 });
    t.record({ category: 'judge', model: 'gpt-4o', tokensIn: 10, tokensOut: 10 });
    const out = computeTokenEfficiency(t, 1);
    expect(out.total).toBe(50);
  });
});
