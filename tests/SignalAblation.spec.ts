/**
 * @file SignalAblation.spec.ts
 * @description Verifies each of the 6 retrieval signals is load-bearing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BenchmarkRunner, SignalAblation } from '../src/index.js';
import { ndcgAtK } from '../src/micro/SignalAblation.js';
import type { IJudge } from '../src/judges/IJudge.js';

const nullJudge: IJudge = {
  model: 'null',
  rubricVersion: '0',
  async judge() {
    throw new Error('NullJudge should never be called by micro-benchmarks.');
  },
};

describe('SignalAblation micro-benchmark', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-ablate-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('each of the 6 retrieval signals produces a measurable NDCG drop when zeroed', async () => {
    const runner = new BenchmarkRunner({
      dataDir: path.join(tmpRoot, 'data'),
      resultsDir: path.join(tmpRoot, 'results'),
      judge: nullJudge,
    });
    const result = await runner.run(new SignalAblation(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(result.totalCases).toBe(6);
    expect(result.passedCases).toBe(6);
    expect(result.accuracy).toBe(1);

    // Every case should show a measurable effect — either a positive
    // NDCG drop or a top-K reshuffle. Both are captured in metadata.
    for (const c of result.cases) {
      const drop = (c.metadata?.drop as number) ?? 0;
      const rankingsDiffer = Boolean(c.metadata?.rankingsDiffer);
      const signal = c.metadata?.signal as string;
      expect(
        drop > 0 || rankingsDiffer,
        `Signal '${signal}' produced drop=${drop} rankingsDiffer=${rankingsDiffer} — no measurable contribution to ranking.`,
      ).toBe(true);
    }
  });

  it('ndcgAtK helper returns 1.0 for identical rankings and <1.0 for permutations', () => {
    const ideal = ['a', 'b', 'c', 'd'];
    expect(ndcgAtK(ideal, ideal, 4)).toBeCloseTo(1);
    // Swapping top two should reduce NDCG.
    const swapped = ['b', 'a', 'c', 'd'];
    const score = ndcgAtK(swapped, ideal, 4);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0.9);
    // Reverse ordering should score clearly worse than partial swap.
    const reversed = ['d', 'c', 'b', 'a'];
    expect(ndcgAtK(reversed, ideal, 4)).toBeLessThan(score);
  });
});
