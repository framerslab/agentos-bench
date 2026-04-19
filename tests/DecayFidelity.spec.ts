/**
 * @file DecayFidelity.spec.ts
 * @description Sanity test for the DecayFidelity micro-benchmark.
 *
 * This test doubles as the integration test for:
 *   - The {@link IBenchmark} contract
 *   - The {@link BenchmarkRunner} orchestration + case caching
 *   - The {@link Cache} filesystem backend
 *   - The {@link ResultStore} persistence layer
 *   - The {@link CostTracker} zero-cost path
 *
 * It verifies that running DecayFidelity against an un-modified AgentOS
 * cognitive decay implementation produces a perfect score (all probes
 * within 2% of the theoretical Ebbinghaus curve).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import { DecayFidelity } from '../src/micro/DecayFidelity.js';
import type { IJudge, JudgeInput, JudgeOutput } from '../src/judges/IJudge.js';

class NullJudge implements IJudge {
  readonly model = 'null';
  readonly rubricVersion = '0';
  async judge(_input: JudgeInput): Promise<JudgeOutput> {
    throw new Error('NullJudge should never be called by micro-benchmarks.');
  }
}

describe('DecayFidelity micro-benchmark', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-decay-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('passes every probe within ±2% of the Ebbinghaus theoretical curve', async () => {
    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new NullJudge(),
    });

    const result = await runner.run(new DecayFidelity(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
      concurrency: 2,
    });

    expect(result.totalCases).toBe(5);
    expect(result.passedCases).toBe(5);
    expect(result.accuracy).toBe(1);
    expect(result.avgScore).toBe(1);
    expect(result.totalUsd).toBe(0);
    // Every probe should have recorded measured + theoretical + relativeError
    for (const caseResult of result.cases) {
      expect(caseResult.passed).toBe(true);
      expect(caseResult.score).toBe(1);
      const err = (caseResult.metadata?.relativeError as number) ?? Number.POSITIVE_INFINITY;
      expect(err).toBeLessThanOrEqual(0.02);
    }
  });

  it('re-uses case-run cache on a second run (zero wall-clock for case work)', async () => {
    const runner = new BenchmarkRunner({ dataDir, resultsDir, judge: new NullJudge() });

    const first = await runner.run(new DecayFidelity(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });
    const second = await runner.run(new DecayFidelity(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(first.accuracy).toBe(1);
    expect(second.accuracy).toBe(1);
    // Second-run per-case work is served from cache. Allow some scheduling
    // slack — we only assert it is no worse than the first run.
    expect(second.avgLatencyMs).toBeLessThanOrEqual(first.avgLatencyMs + 5);
  });

  it('persists a run JSON file and updates the rolling summary', async () => {
    const runner = new BenchmarkRunner({ dataDir, resultsDir, judge: new NullJudge() });
    await runner.run(new DecayFidelity(), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    const microDir = path.join(resultsDir, 'micro');
    const entries = await fs.readdir(microDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toContain('decay-fidelity');

    const summary = JSON.parse(await fs.readFile(path.join(resultsDir, 'summary.json'), 'utf8'));
    expect(Object.keys(summary.latest)).toHaveLength(1);
    const entry = Object.values(summary.latest)[0] as { accuracy: number };
    expect(entry.accuracy).toBe(1);
  });
});
