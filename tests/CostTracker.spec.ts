/**
 * @file CostTracker.spec.ts
 * @description Tests for the cost accounting layer.
 *
 * Covers:
 *   - Exact price lookups for known models.
 *   - Versioned-name fallback (`gpt-4o-2024-11-20` → `gpt-4o`).
 *   - Unknown-model warning path (records $0, does not throw).
 *   - Per-category bookkeeping (reader / embedding / judge).
 *   - Budget enforcement via ensureBudget.
 */

import { describe, it, expect } from 'vitest';
import { CostTracker } from '../src/core/CostTracker.js';

describe('CostTracker', () => {
  it('prices known models exactly', () => {
    const t = new CostTracker();
    const usd = t.record({
      category: 'reader',
      model: 'gpt-4o',
      tokensIn: 1000,
      tokensOut: 500,
    });
    // gpt-4o: $0.0025/1k prompt, $0.01/1k completion
    expect(usd).toBeCloseTo(0.0025 + 0.005, 6);
    expect(t.totals.readerUsd).toBeCloseTo(usd, 6);
    expect(t.totals.totalUsd).toBeCloseTo(usd, 6);
  });

  it('falls back to the base-model match for versioned names', () => {
    // Providers commonly echo a version suffix (gpt-4o-2024-11-20,
    // claude-sonnet-4-6-20260315). Without a fallback the tracker silently
    // recorded $0 and the bench displayed free-of-charge runs.
    const t = new CostTracker();
    const usd = t.record({
      category: 'reader',
      model: 'gpt-4o-2024-11-20',
      tokensIn: 1000,
      tokensOut: 500,
    });
    expect(usd).toBeGreaterThan(0);
    expect(usd).toBeCloseTo(0.0025 + 0.005, 6);
  });

  it('falls back for versioned Claude names too', () => {
    const t = new CostTracker();
    const usd = t.record({
      category: 'reader',
      model: 'claude-sonnet-4-6-20260315',
      tokensIn: 1000,
      tokensOut: 500,
    });
    // claude-sonnet-4-6: $0.003/1k prompt, $0.015/1k completion
    expect(usd).toBeCloseTo(0.003 + 0.0075, 6);
  });

  it('records $0 and warns once for an unknown model family', () => {
    const t = new CostTracker();
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      t.record({ category: 'reader', model: 'unknown-model-foo', tokensIn: 100, tokensOut: 20 });
      t.record({ category: 'reader', model: 'unknown-model-foo', tokensIn: 100, tokensOut: 20 });
    } finally {
      console.warn = originalWarn;
    }
    expect(t.totals.totalUsd).toBe(0);
    expect(warnings.filter((w) => w.includes('unknown-model-foo')).length).toBe(1);
  });

  it('tracks per-category sub-totals', () => {
    const t = new CostTracker();
    t.record({ category: 'reader', model: 'gpt-4o', tokensIn: 1000, tokensOut: 0 });
    t.record({ category: 'judge', model: 'gpt-4o', tokensIn: 500, tokensOut: 10 });
    t.record({
      category: 'embedding',
      model: 'text-embedding-3-small',
      tokensIn: 5000,
      tokensOut: 0,
    });
    const c = t.byCategory;
    expect(c.reader.readerUsd).toBeGreaterThan(0);
    expect(c.judge.judgeUsd).toBeGreaterThan(0);
    expect(c.embedding.embeddingUsd).toBeGreaterThan(0);
    expect(c.reader.readerUsd + c.judge.judgeUsd + c.embedding.embeddingUsd).toBeCloseTo(
      t.totals.totalUsd,
      6,
    );
  });

  it('ensureBudget throws when projected spend exceeds the cap', () => {
    const t = new CostTracker();
    t.record({ category: 'reader', model: 'gpt-4o', tokensIn: 100_000, tokensOut: 0 });
    expect(() => t.ensureBudget(5, 1)).toThrow(/exceeds --max-usd/);
  });

  it('ensureBudget is a no-op when maxUsd is undefined', () => {
    const t = new CostTracker();
    expect(() => t.ensureBudget(1000, undefined)).not.toThrow();
  });
});
