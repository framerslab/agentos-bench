import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  computeJudgeAdversarialRate,
  synthesizeAdversarialAnswer,
  ADVERSARIAL_SYNTH_VERSION,
} from '../src/core/metrics/computeJudgeAdversarial.js';
import type { IJudge, JudgeInput, JudgeOutput } from '../src/judges/IJudge.js';
import type { IReader, ReaderRequest, ReaderResponse } from '../src/readers/IReader.js';

class FakeSynth implements IReader {
  readonly model = 'fake-synth';
  public calls = 0;
  async invoke(_req: ReaderRequest): Promise<ReaderResponse> {
    this.calls += 1;
    return {
      text: 'A plausible but specifically wrong answer.',
      tokensIn: 100,
      tokensOut: 20,
      model: this.model,
      latencyMs: 10,
    };
  }
}

class FakeJudge implements IJudge {
  readonly model = 'fake-judge';
  readonly rubricVersion = 'v1';
  public calls = 0;
  public forceCorrect = false;
  async judge(_input: JudgeInput): Promise<JudgeOutput> {
    this.calls += 1;
    return {
      score: this.forceCorrect ? 1 : 0,
      correct: this.forceCorrect,
      reasoning: 'mock',
      judgeModel: this.model,
      tokensIn: 50,
      tokensOut: 10,
      rubricVersion: this.rubricVersion,
    };
  }
}

describe('synthesizeAdversarialAnswer', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-test-'));
  });

  it('invokes the synth invoker on cache miss and writes to cache', async () => {
    const synth = new FakeSynth();
    const out = await synthesizeAdversarialAnswer({
      caseId: 'c-1',
      question: 'What sugar did the user buy?',
      goldAnswer: 'turbinado sugar',
      caseType: 'single-session-preference',
      invoker: synth,
      cacheDir,
    });
    expect(out.text).toMatch(/plausible/);
    expect(out.cached).toBe(false);
    expect(synth.calls).toBe(1);

    const files = await fs.readdir(cacheDir, { recursive: true });
    expect(files.some((f) => String(f).endsWith('.json'))).toBe(true);
  });

  it('returns cached value on second call with same inputs', async () => {
    const synth = new FakeSynth();
    await synthesizeAdversarialAnswer({
      caseId: 'c-1',
      question: 'Q',
      goldAnswer: 'A',
      caseType: 't',
      invoker: synth,
      cacheDir,
    });
    const second = await synthesizeAdversarialAnswer({
      caseId: 'c-1',
      question: 'Q',
      goldAnswer: 'A',
      caseType: 't',
      invoker: synth,
      cacheDir,
    });
    expect(second.cached).toBe(true);
    expect(synth.calls).toBe(1);
  });

  it('re-synthesizes when gold answer changes', async () => {
    const synth = new FakeSynth();
    await synthesizeAdversarialAnswer({
      caseId: 'c-1',
      question: 'Q',
      goldAnswer: 'A',
      caseType: 't',
      invoker: synth,
      cacheDir,
    });
    await synthesizeAdversarialAnswer({
      caseId: 'c-1',
      question: 'Q',
      goldAnswer: 'DIFFERENT',
      caseType: 't',
      invoker: synth,
      cacheDir,
    });
    expect(synth.calls).toBe(2);
  });

  it('bakes the version into the cache key', () => {
    expect(typeof ADVERSARIAL_SYNTH_VERSION).toBe('string');
    expect(ADVERSARIAL_SYNTH_VERSION.length).toBeGreaterThan(0);
  });
});

describe('computeJudgeAdversarialRate', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adv-rate-test-'));
  });

  it('returns zero FPR when judge never says correct', async () => {
    const synth = new FakeSynth();
    const judge = new FakeJudge();
    judge.forceCorrect = false;
    const cases = Array.from({ length: 10 }, (_, i) => ({
      id: `c-${i}`,
      type: 'single-session-user',
      question: 'Q',
      expected: 'A',
    }));
    const r = await computeJudgeAdversarialRate({
      cases,
      benchmarkId: 'test',
      judge,
      synthesizer: synth,
      cacheDir,
      maxProbes: 10,
      resamples: 500,
      seed: 1,
    });
    expect(r.rate).toBe(0);
    expect(r.samplesProbed).toBe(10);
    expect(synth.calls).toBe(10);
    expect(judge.calls).toBe(10);
  });

  it('caps probes at maxProbes', async () => {
    const synth = new FakeSynth();
    const judge = new FakeJudge();
    const cases = Array.from({ length: 100 }, (_, i) => ({
      id: `c-${i}`,
      type: 't',
      question: 'Q',
      expected: 'A',
    }));
    const r = await computeJudgeAdversarialRate({
      cases,
      benchmarkId: 'test',
      judge,
      synthesizer: synth,
      cacheDir,
      maxProbes: 15,
      resamples: 500,
      seed: 1,
    });
    expect(r.samplesProbed).toBe(15);
    expect(synth.calls).toBe(15);
    expect(judge.calls).toBe(15);
  });

  it('computes FPR by case type', async () => {
    const synth = new FakeSynth();
    const judge = new FakeJudge();
    let toggle = false;
    judge.judge = async (_input): Promise<JudgeOutput> => {
      judge.calls += 1;
      toggle = !toggle;
      return {
        score: toggle ? 1 : 0,
        correct: toggle,
        reasoning: 'alt',
        judgeModel: judge.model,
        tokensIn: 50,
        tokensOut: 10,
        rubricVersion: judge.rubricVersion,
      };
    };
    const cases = [
      { id: 'a-1', type: 'typeA', question: 'Q', expected: 'A' },
      { id: 'a-2', type: 'typeA', question: 'Q', expected: 'A' },
      { id: 'b-1', type: 'typeB', question: 'Q', expected: 'A' },
      { id: 'b-2', type: 'typeB', question: 'Q', expected: 'A' },
    ];
    const r = await computeJudgeAdversarialRate({
      cases,
      benchmarkId: 'test',
      judge,
      synthesizer: synth,
      cacheDir,
      maxProbes: 10,
      resamples: 500,
      seed: 1,
    });
    expect(r.rate).toBe(0.5);
    expect(r.byCaseType.typeA).toBeDefined();
    expect(r.byCaseType.typeB).toBeDefined();
    expect(r.samplesProbed).toBe(4);
  });

  it('attaches bootstrap CI fields', async () => {
    const synth = new FakeSynth();
    const judge = new FakeJudge();
    const cases = Array.from({ length: 20 }, (_, i) => ({
      id: `c-${i}`,
      type: 't',
      question: 'Q',
      expected: 'A',
    }));
    const r = await computeJudgeAdversarialRate({
      cases,
      benchmarkId: 'test',
      judge,
      synthesizer: synth,
      cacheDir,
      maxProbes: 20,
      resamples: 500,
      seed: 1,
    });
    expect(r.ciLo).toBeGreaterThanOrEqual(0);
    expect(r.ciHi).toBeLessThanOrEqual(1);
    expect(r.ciHi).toBeGreaterThanOrEqual(r.ciLo);
  });
});
