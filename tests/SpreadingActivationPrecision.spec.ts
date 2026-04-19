/**
 * @file SpreadingActivationPrecision.spec.ts
 * @description Verifies Anderson's spreading activation keeps activation
 * contained within the seed's associative cluster on a synthetic graph
 * with known cluster structure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import { SpreadingActivationPrecision } from '../src/micro/SpreadingActivationPrecision.js';
import type { IJudge } from '../src/judges/IJudge.js';

const nullJudge: IJudge = {
  model: 'null',
  rubricVersion: '0',
  async judge() {
    throw new Error('NullJudge should never be called by micro-benchmarks.');
  },
};

describe('SpreadingActivationPrecision micro-benchmark', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-spread-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('keeps ≥80% of activation within the seed cluster for each cluster seed', async () => {
    const runner = new BenchmarkRunner({
      dataDir: path.join(tmpRoot, 'data'),
      resultsDir: path.join(tmpRoot, 'results'),
      judge: nullJudge,
    });
    const result = await runner.run(new SpreadingActivationPrecision(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(result.totalCases).toBe(3);
    expect(result.passedCases).toBe(3);
    expect(result.accuracy).toBe(1);
    for (const c of result.cases) {
      const precision = (c.metadata?.precision as number) ?? 0;
      expect(precision).toBeGreaterThanOrEqual(0.8);
      const activatedCount = (c.metadata?.activatedCount as number) ?? 0;
      expect(activatedCount).toBeGreaterThan(0);
    }
  });
});
