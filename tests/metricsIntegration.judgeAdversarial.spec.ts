import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runAdversarialProbeIfEnabled } from '../src/core/BenchmarkRunner.js';
import type { IJudge, JudgeInput, JudgeOutput } from '../src/judges/IJudge.js';
import type { IReader, ReaderRequest, ReaderResponse } from '../src/readers/IReader.js';
import type { BenchCase, BenchResult } from '../src/core/IBenchmark.js';
import { Locomo } from '../src/benchmarks/locomo/Locomo.js';
import { Beam } from '../src/benchmarks/beam/Beam.js';
import { MockReader } from '../src/readers/MockReader.js';

class QuietSynth implements IReader {
  readonly model = 'fake-synth';
  async invoke(_req: ReaderRequest): Promise<ReaderResponse> {
    return {
      text: 'wrong-answer',
      tokensIn: 50,
      tokensOut: 10,
      model: this.model,
      latencyMs: 1,
    };
  }
}

class AcceptAllJudge implements IJudge {
  readonly model = 'fake-judge';
  readonly rubricVersion = 'v1';
  async judge(_input: JudgeInput): Promise<JudgeOutput> {
    return {
      score: 1,
      correct: true,
      reasoning: 'accept',
      judgeModel: this.model,
      tokensIn: 30,
      tokensOut: 5,
      rubricVersion: this.rubricVersion,
    };
  }
}

function fakeCase(id: string, type = 'typeA'): BenchCase {
  return { id, type, question: 'Q', haystack: [], expected: 'A' };
}

function fakeResult(): BenchResult {
  return {
    benchmarkId: 'test',
    benchmarkVersion: '1.0.0',
    config: { reader: 'gpt-4o', memoryMode: 'none', replayMode: 'ingest' },
    totalCases: 4,
    passedCases: 2,
    accuracy: 0.5,
    avgScore: 0.5,
    scoreStdDev: 0,
    byType: { typeA: { n: 4, accuracy: 0.5, avgScore: 0.5 } },
    avgLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    totalReaderTokens: 0,
    totalUsd: 0,
    costPerCorrect: 0,
    startedAt: '',
    completedAt: '',
    cases: Array.from({ length: 4 }, (_, i) => ({
      caseId: `c-${i}`,
      actualOutput: '',
      latencyMs: 1,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      score: i % 2,
      passed: i % 2 === 0,
      metadata: { caseType: 'typeA' },
    })),
  };
}

describe('runAdversarialProbeIfEnabled', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-int-'));
  });

  it('returns result unchanged when enabled is false', async () => {
    const result = fakeResult();
    const out = await runAdversarialProbeIfEnabled({
      result,
      cases: [fakeCase('c-0'), fakeCase('c-1'), fakeCase('c-2'), fakeCase('c-3')],
      benchmarkId: 'test',
      judge: new AcceptAllJudge(),
      synthesizer: new QuietSynth(),
      cacheDir,
      enabled: false,
    });
    expect(out.judgeAdversarialFPR).toBeUndefined();
  });

  it('populates judgeAdversarialFPR when enabled', async () => {
    const result = fakeResult();
    const out = await runAdversarialProbeIfEnabled({
      result,
      cases: [fakeCase('c-0'), fakeCase('c-1'), fakeCase('c-2'), fakeCase('c-3')],
      benchmarkId: 'test',
      judge: new AcceptAllJudge(),
      synthesizer: new QuietSynth(),
      cacheDir,
      enabled: true,
      maxProbes: 4,
      resamples: 500,
      seed: 3,
    });
    expect(out.judgeAdversarialFPR).toBeDefined();
    expect(out.judgeAdversarialFPR!.rate).toBe(1);
    expect(out.judgeAdversarialFPR!.samplesProbed).toBe(4);
  });
});

/** A judge that accepts everything and keeps each input it is sent. */
class RecordingJudge extends AcceptAllJudge {
  readonly inputs: JudgeInput[] = [];
  override async judge(input: JudgeInput): Promise<JudgeOutput> {
    this.inputs.push(input);
    return super.judge(input);
  }
}

describe('runAdversarialProbeIfEnabled judges a distractor as the benchmark judges a real answer', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-rubric-'));
  });

  const probe = async (benchmark: Locomo | Beam, cases: BenchCase[]): Promise<JudgeInput[]> => {
    const judge = new RecordingJudge();
    const params = {
      result: fakeResult(),
      cases,
      benchmark,
      benchmarkId: benchmark.id,
      judge,
      synthesizer: new QuietSynth(),
      cacheDir,
      enabled: true,
      maxProbes: cases.length,
      resamples: 100,
      seed: 1,
    };
    await runAdversarialProbeIfEnabled(params);
    return judge.inputs;
  };

  it("on LoCoMo: a category 5 (adversarial) case gets the abstention rubric, a temporal one LongMemEval's temporal rubric", async () => {
    const inputs = await probe(new Locomo({ reader: new MockReader('gpt-4o-mini') }), [
      { ...fakeCase('conv-1-q1', 'adversarial'), metadata: { abstention: true } },
      { ...fakeCase('conv-1-q2', 'temporal'), metadata: { abstention: false } },
    ]);
    expect(inputs.map((i) => [i.caseId, i.caseType, i.hints, i.actual])).toEqual([
      ['conv-1-q1', 'abstention', { abstention: true }, 'wrong-answer'],
      ['conv-1-q2', 'temporal-reasoning', { abstention: false }, 'wrong-answer'],
    ]);
  });

  it('on BEAM: an abstention case gets the abstention rubric, a knowledge-update one its rubric', async () => {
    const inputs = await probe(new Beam({ reader: new MockReader('gpt-4o-mini'), tier: '100k' }), [
      fakeCase('beam-1', 'abstention'),
      fakeCase('beam-2', 'knowledge_update'),
    ]);
    expect(inputs.map((i) => [i.caseId, i.caseType, i.hints?.abstention, i.actual])).toEqual([
      ['beam-1', 'abstention', true, 'wrong-answer'],
      ['beam-2', 'knowledge-update', false, 'wrong-answer'],
    ]);
  });
});
