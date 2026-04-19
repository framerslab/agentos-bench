/**
 * @file Beam.placeholder.spec.ts
 * @description Locks down BEAM placeholder behaviour: every lifecycle
 * method throws BeamUnimplementedError with a helpful pointer until the
 * upstream schema is published. Catches accidental "silent passes"
 * where the adapter might otherwise fall through to a default and
 * produce misleading numbers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Beam,
  BeamUnimplementedError,
  BenchmarkRunner,
  LongMemEvalJudge,
  MockReader,
  type BeamTier,
} from '../src/index.js';

const TIERS: BeamTier[] = ['500k', '1m', '10m'];

describe('BEAM placeholder adapter', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-beam-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it.each(TIERS)('Beam(%s).id is beam-<tier> and family is external', (tier) => {
    const b = new Beam({ reader: new MockReader(), tier });
    expect(b.id).toBe(`beam-${tier}`);
    expect(b.family).toBe('external');
    expect(b.version).toBe('0.0.0-placeholder');
  });

  it.each(TIERS)('Beam(%s).setup throws BeamUnimplementedError', async (tier) => {
    const b = new Beam({ reader: new MockReader(), tier });
    const ctx = await buildEmptyContext({ dataDir, resultsDir });
    await expect(b.setup(ctx)).rejects.toBeInstanceOf(BeamUnimplementedError);
  });

  it.each(TIERS)('Beam(%s).loadTestCases throws BeamUnimplementedError', async (tier) => {
    const b = new Beam({ reader: new MockReader(), tier });
    const ctx = await buildEmptyContext({ dataDir, resultsDir });
    await expect(b.loadTestCases(ctx)).rejects.toBeInstanceOf(BeamUnimplementedError);
  });

  it('error message points to the Beam.ts extension checklist', async () => {
    const b = new Beam({ reader: new MockReader(), tier: '10m' });
    const ctx = await buildEmptyContext({ dataDir, resultsDir });
    try {
      await b.setup(ctx);
      throw new Error('expected setup() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BeamUnimplementedError);
      expect((err as Error).message).toContain('packages/agentos-bench/src/benchmarks/beam/Beam.ts');
      expect((err as Error).message).toContain('10m');
    }
  });

  it('driving BEAM through BenchmarkRunner fails fast without producing a run file', async () => {
    const readerMock = new MockReader('claude-sonnet-4-6');
    const judgeMock = new MockReader('gpt-4o').on(
      () => true,
      () => ({ text: 'no', tokensIn: 1, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );

    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
    });

    await expect(
      runner.run(new Beam({ reader: readerMock, tier: '1m' }), {
        reader: 'claude-sonnet-4-6',
        memoryMode: 'none',
        replayMode: 'ingest',
      }),
    ).rejects.toBeInstanceOf(BeamUnimplementedError);

    // No run file should have been persisted.
    const runs = await fs.readdir(path.join(resultsDir, 'runs')).catch(() => []);
    expect(runs.filter((f) => f.includes('beam-')).length).toBe(0);
  });
});

/** Minimal BenchContext suitable for lifecycle-only assertions. */
async function buildEmptyContext(opts: {
  dataDir: string;
  resultsDir: string;
}): Promise<import('../src/core/IBenchmark.js').BenchContext> {
  const { Cache } = await import('../src/core/Cache.js');
  const { CostTracker } = await import('../src/core/CostTracker.js');
  return {
    config: {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
      concurrency: 1,
    },
    judge: {
      model: 'null',
      rubricVersion: '0',
      async judge() {
        throw new Error('no judge in placeholder test');
      },
    },
    cache: new Cache(path.join(opts.dataDir, 'cache')),
    costTracker: new CostTracker(),
    dataDir: opts.dataDir,
    scratchDir: opts.resultsDir,
  };
}
