/**
 * @file ScalingProfile.spec.ts
 * @description Verifies retrieval scoring stays within latency budgets
 * at 1k and 10k candidate sizes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import { ScalingProfile } from '../src/micro/ScalingProfile.js';
import type { IJudge } from '../src/judges/IJudge.js';

const nullJudge: IJudge = {
  model: 'null',
  rubricVersion: '0',
  async judge() {
    throw new Error('NullJudge should never be called by micro-benchmarks.');
  },
};

describe('ScalingProfile micro-benchmark', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-scale-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('scores 1k and 10k candidate pools inside per-size latency budgets', async () => {
    const runner = new BenchmarkRunner({
      dataDir: path.join(tmpRoot, 'data'),
      resultsDir: path.join(tmpRoot, 'results'),
      judge: nullJudge,
    });
    const result = await runner.run(new ScalingProfile(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(result.totalCases).toBe(2);
    expect(result.passedCases).toBe(2);
    expect(result.accuracy).toBe(1);
    for (const c of result.cases) {
      const p50 = c.metadata?.p50Ms as number;
      const p95 = c.metadata?.p95Ms as number;
      const budget = c.metadata?.budgetMs as number;
      expect(p50).toBeGreaterThanOrEqual(0);
      expect(p95).toBeLessThanOrEqual(budget);
    }
  });
});
