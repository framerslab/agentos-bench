/**
 * @file scratchDir.spec.ts
 * @description Each run gets a scratch directory of its own. The runner removes it when the run ends, so two runs that
 * shared one (the same benchmark, started in the same millisecond, in two processes or one) would lose each other's
 * brain files mid-run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import type { BenchContext, IBenchmark, RunConfig } from '../src/core/IBenchmark.js';
import { LongMemEvalJudge, MockReader } from '../src/index.js';

/** A benchmark whose setup records the run's scratch directory, waits until `gate` opens, then stops the run. */
function recordingBenchmark(seen: string[], entered: () => void, gate: Promise<void>): IBenchmark {
  return {
    id: 'scratch-probe',
    version: '1',
    family: 'micro',
    passThreshold: 1,
    async setup(ctx: BenchContext) {
      seen.push(ctx.scratchDir);
      expect(existsSync(ctx.scratchDir)).toBe(true);
      entered();
      await gate;
      throw new Error('stop after setup');
    },
    loadTestCases: async () => [],
    runCase: async () => {
      throw new Error('unused');
    },
    scoreCase: async () => {
      throw new Error('unused');
    },
    aggregate: () => {
      throw new Error('unused');
    },
  };
}

describe('the scratch directory of a run', () => {
  let tmp: string | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('is its own for each of two runs of one benchmark that start in the same millisecond', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-scratch-'));
    const scratchRoot = path.join(tmp, 'scratch');
    const runner = new BenchmarkRunner({
      dataDir: path.join(tmp, 'data'),
      resultsDir: path.join(tmp, 'results'),
      judge: new LongMemEvalJudge({ reader: new MockReader('gpt-4o') }),
      scratchRoot,
    });
    // The clock stands still, so both runs carry the same start time.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));

    const seen: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let inside = 0;
    const entered = () => {
      inside += 1;
      if (inside === 2) open();
    };
    const config = { reader: 'gpt-4o', memoryMode: 'full-cognitive', replayMode: 'observe' } as RunConfig;
    const settled = await Promise.allSettled([
      runner.run(recordingBenchmark(seen, entered, gate), config),
      runner.run(recordingBenchmark(seen, entered, gate), config),
    ]);
    expect(settled.map((s) => (s.status === 'rejected' ? String(s.reason) : 'resolved'))).toEqual([
      'Error: stop after setup',
      'Error: stop after setup',
    ]);

    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
    for (const dir of seen) {
      expect(path.dirname(dir)).toBe(path.join(scratchRoot, 'agentos-bench'));
      expect(path.basename(dir).startsWith('scratch-probe-')).toBe(true);
      // Each run removes its own directory when it ends.
      expect(existsSync(dir)).toBe(false);
    }
  });
});
