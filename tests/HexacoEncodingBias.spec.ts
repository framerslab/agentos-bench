/**
 * @file HexacoEncodingBias.spec.ts
 * @description Verifies the HexacoEncodingBias micro-benchmark passes
 * on an unmodified AgentOS encoding model. Regression signal: if any
 * HEXACO trait stops biasing encoding in the documented direction,
 * this fails and surfaces which trait broke.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import { HexacoEncodingBias } from '../src/micro/HexacoEncodingBias.js';
import type { IJudge } from '../src/judges/IJudge.js';

const nullJudge: IJudge = {
  model: 'null',
  rubricVersion: '0',
  async judge() {
    throw new Error('NullJudge should never be called by micro-benchmarks.');
  },
};

describe('HexacoEncodingBias micro-benchmark', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-hexaco-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('every HEXACO trait biases encoding in the predicted direction', async () => {
    const runner = new BenchmarkRunner({ dataDir, resultsDir, judge: nullJudge });
    const result = await runner.run(new HexacoEncodingBias(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(result.totalCases).toBe(6);
    expect(result.passedCases).toBe(6);
    expect(result.accuracy).toBe(1);

    // Every case should have recorded a positive margin above the required
    // threshold.
    for (const caseResult of result.cases) {
      const margin = (caseResult.metadata?.margin as number) ?? -1;
      expect(margin).toBeGreaterThanOrEqual(0.02);
      expect(caseResult.passed).toBe(true);
    }
  });
});
