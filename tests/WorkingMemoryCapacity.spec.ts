/**
 * @file WorkingMemoryCapacity.spec.ts
 * @description Verifies the WorkingMemoryCapacity micro-benchmark
 * passes on an unmodified AgentOS cognitive working memory.
 *
 * Covers: Miller's 7-slot baseline, HEXACO Openness +1, Conscientiousness
 * -1, cancelling modulation, enforcement under overflow, and
 * LRU-by-activation eviction order.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import { WorkingMemoryCapacity } from '../src/micro/WorkingMemoryCapacity.js';
import type { IJudge } from '../src/judges/IJudge.js';

const nullJudge: IJudge = {
  model: 'null',
  rubricVersion: '0',
  async judge() {
    throw new Error('NullJudge should never be called by micro-benchmarks.');
  },
};

describe('WorkingMemoryCapacity micro-benchmark', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-wm-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('enforces Baddeley 7±2 capacity with HEXACO modulation and LRU eviction', async () => {
    const runner = new BenchmarkRunner({ dataDir, resultsDir, judge: nullJudge });
    const result = await runner.run(new WorkingMemoryCapacity(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(result.totalCases).toBe(5);
    expect(result.passedCases).toBe(5);
    expect(result.accuracy).toBe(1);
    for (const c of result.cases) {
      expect(c.passed).toBe(true);
      const expected = c.metadata?.expectedCapacity as number;
      const observed = c.metadata?.observedCapacity as number;
      expect(observed).toBe(expected);
      const finalSlotCount = c.metadata?.finalSlotCount as number;
      expect(finalSlotCount).toBeLessThanOrEqual(expected);
    }
  });
});
