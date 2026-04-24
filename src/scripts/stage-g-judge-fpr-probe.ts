/**
 * Stage G — standalone judge-adversarial probe.
 *
 * Loads the LongMemEval-S dataset, samples cases, runs
 * computeJudgeAdversarialRate directly (no benchmark re-run), reports
 * the FPR with bootstrap CI per category.
 *
 * Usage: pnpm tsx scripts/stage-g-judge-fpr-probe.ts [maxProbes]
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  computeJudgeAdversarialRate,
  type AdversarialProbeCase,
} from '../core/metrics/computeJudgeAdversarial.js';
import { loadLongMemEvalDataset } from '../benchmarks/longmemeval/dataset.js';
import { LongMemEvalJudge } from '../judges/LongMemEvalJudge.js';
import { createReader } from '../readers/createReader.js';
import type { BenchCase } from '../core/IBenchmark.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  const maxProbes = Number(process.argv[2] ?? 100);
  const seed = 42;
  const dataDir = path.resolve(process.cwd(), 'data');
  const cacheDir = path.join(dataDir, '.judge-adversarial-cache-stage-g');
  await fs.mkdir(cacheDir, { recursive: true });

  const benchCases = (await loadLongMemEvalDataset(dataDir, 's')) as BenchCase[];
  const filtered = benchCases.filter((c: BenchCase) => c.type !== 'unknown');

  const rng = mulberry32(seed);
  const shuffled = filtered
    .map((c: BenchCase) => ({ c, r: rng() }))
    .sort((a: { r: number }, b: { r: number }) => a.r - b.r)
    .map((x: { c: BenchCase }) => x.c);
  const sampled = shuffled.slice(0, maxProbes);
  const probeCases: AdversarialProbeCase[] = sampled.map((c: BenchCase) => ({
    id: c.id,
    type: c.type,
    question: c.question,
    expected: c.expected,
  }));

  const synthesizer = createReader('gpt-5-mini');
  const judgeReader = createReader('gpt-4o');
  const judge = new LongMemEvalJudge({ reader: judgeReader });

  const started = Date.now();
  const out = await computeJudgeAdversarialRate({
    cases: probeCases,
    benchmarkId: 'longmemeval-s',
    judge,
    synthesizer,
    cacheDir,
    maxProbes,
    resamples: 10_000,
    seed,
  });
  const elapsedMs = Date.now() - started;

  console.log(
    JSON.stringify(
      {
        maxProbes,
        samplesProbed: out.samplesProbed,
        fpr: out.rate,
        ci: [out.ciLo, out.ciHi],
        byCaseType: out.byCaseType,
        synthModel: out.synthModel,
        judgeModel: out.judgeModel,
        rubricVersion: out.rubricVersion,
        synthTokensIn: out.synthTokensIn,
        synthTokensOut: out.synthTokensOut,
        judgeTokensIn: out.judgeTokensIn,
        judgeTokensOut: out.judgeTokensOut,
        elapsedMs,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
