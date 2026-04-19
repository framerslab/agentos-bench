/**
 * @file ConsolidationSignalPreservation.spec.ts
 * @description Verifies flashbulb-immunity invariant across
 * reconsolidation, RIF, and emotion regulation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import { ConsolidationSignalPreservation } from '../src/micro/ConsolidationSignalPreservation.js';
import type { IJudge } from '../src/judges/IJudge.js';

const nullJudge: IJudge = {
  model: 'null',
  rubricVersion: '0',
  async judge() {
    throw new Error('NullJudge should never be called by micro-benchmarks.');
  },
};

describe('ConsolidationSignalPreservation micro-benchmark', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-consol-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('flashbulb traces survive reconsolidation, RIF, and emotion regulation', async () => {
    const runner = new BenchmarkRunner({
      dataDir: path.join(tmpRoot, 'data'),
      resultsDir: path.join(tmpRoot, 'results'),
      judge: nullJudge,
    });
    const result = await runner.run(new ConsolidationSignalPreservation(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(result.totalCases).toBe(3);
    expect(result.passedCases).toBe(3);
    expect(result.accuracy).toBe(1);
    for (const c of result.cases) {
      expect(c.passed).toBe(true);
      expect(c.metadata?.flashbulbProtected).toBe(true);
      expect(c.metadata?.baselineAffected).toBe(true);
    }
  });
});
