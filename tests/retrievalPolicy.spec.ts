import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { BenchCase, BenchContext } from '../src/core/IBenchmark.js';
import { LongMemEvalS } from '../src/benchmarks/longmemeval/LongMemEvalS.js';
import { MockReader } from '../src/readers/MockReader.js';

describe('bench retrieval policy alignment', () => {
  const scratchRoots: string[] = [];

  afterEach(async () => {
    const { promises: fs } = await import('node:fs');
    await Promise.all(scratchRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    scratchRoots.length = 0;
  });

  it('records retrieval policy in case metadata for full-cognitive runs', async () => {
    const bench = new LongMemEvalS({
      reader: new MockReader('gpt-4o'),
      variant: 's',
    });

    const testCase: BenchCase = {
      id: 'case-1',
      type: 'single-session-user',
      question: 'What ships Friday?',
      expected: 'Atlas',
      haystack: [
        {
          sessionId: 's1',
          date: '2026-04-18',
          turns: [
            { role: 'user', content: 'Project Atlas ships Friday.' },
            { role: 'assistant', content: 'Noted.' },
          ],
        },
      ],
    };

    const scratchDir = await import('node:fs').then(({ promises: fs }) =>
      fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-retrieval-policy-')),
    );
    scratchRoots.push(scratchDir);

    const run = await bench.runCase(testCase, {
      config: {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'observe',
        concurrency: 1,
        retrievalProfile: 'balanced',
        adaptiveRetrieval: true,
      },
      cache: {} as never,
      judge: {} as never,
      costTracker: { record: () => 0 } as never,
      dataDir: scratchDir,
      scratchDir,
    } as BenchContext);

    expect(run.metadata?.retrievalPolicy).toMatchObject({
      profile: 'balanced',
      adaptive: true,
    });
  });
});
