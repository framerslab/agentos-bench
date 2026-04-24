/**
 * Stage G-LOCOMO — standalone judge-adversarial probe for LOCOMO.
 *
 * Mirror of `stage-g-judge-fpr-probe.ts` but loads LOCOMO cases via
 * `loadLocomoDataset` and remaps LOCOMO category names to the
 * LongMemEval rubric (same remapping Locomo.ts uses at runtime). Scores
 * topically-adjacent wrong answers with the same `gpt-4o-2024-08-06`
 * judge + `rubricVersion 2026-04-18.1` rubric we score real LOCOMO
 * answers against, so the result is directly comparable to Penfield
 * Labs' 62.81% FPR finding on LOCOMO's default judge.
 *
 * Usage: `pnpm build && node dist/scripts/stage-g-locomo-judge-fpr-probe.js [maxProbes]`
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  computeJudgeAdversarialRate,
  type AdversarialProbeCase,
} from '../core/metrics/computeJudgeAdversarial.js';
import { loadLocomoDataset } from '../benchmarks/locomo/dataset.js';
import { LongMemEvalJudge } from '../judges/LongMemEvalJudge.js';
import { createReader } from '../readers/createReader.js';
import type { BenchCase } from '../core/IBenchmark.js';

/**
 * Map LOCOMO category → LongMemEval rubric name. Identical to
 * `Locomo.ts` remapCategoryToRubric — replicated here so the probe
 * script stays standalone (no cross-import from benchmark adapter).
 */
function remapCategoryToRubric(locomoType: string): string {
  switch (locomoType) {
    case 'temporal':
      return 'temporal-reasoning';
    case 'adversarial':
      return 'abstention';
    case 'single-hop':
    case 'multi-hop':
    case 'open-domain':
    default:
      return 'multi-session';
  }
}

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
  const cacheDir = path.join(dataDir, '.judge-adversarial-cache-stage-g-locomo');
  await fs.mkdir(cacheDir, { recursive: true });

  const benchCases = (await loadLocomoDataset(dataDir)) as BenchCase[];
  const filtered = benchCases.filter((c: BenchCase) => c.type !== 'unknown');

  const rng = mulberry32(seed);
  const shuffled = filtered
    .map((c: BenchCase) => ({ c, r: rng() }))
    .sort((a: { r: number }, b: { r: number }) => a.r - b.r)
    .map((x: { c: BenchCase }) => x.c);
  const sampled = shuffled.slice(0, maxProbes);
  const probeCases: AdversarialProbeCase[] = sampled.map((c: BenchCase) => ({
    id: c.id,
    // Preserve the native LOCOMO type in output but route through the
    // LongMemEval rubric for judging. Output per-category rows use the
    // LOCOMO names the caller expects (single-hop, multi-hop, etc.).
    type: c.type,
    question: c.question,
    expected: c.expected,
  }));

  // Remap types at judge call-site via a wrapper: the adversarial probe
  // passes `c.type` directly to the judge's `caseType` param, so we
  // rewrite the probe-case type to the rubric name before probing and
  // restore a display-friendly breakdown after.
  const rubricProbeCases: AdversarialProbeCase[] = probeCases.map((p) => ({
    ...p,
    type: remapCategoryToRubric(p.type),
  }));

  const synthesizer = createReader('gpt-5-mini');
  const judgeReader = createReader('gpt-4o');
  const judge = new LongMemEvalJudge({ reader: judgeReader });

  const started = Date.now();
  const out = await computeJudgeAdversarialRate({
    cases: rubricProbeCases,
    benchmarkId: 'locomo',
    judge,
    synthesizer,
    cacheDir,
    maxProbes,
    resamples: 10_000,
    seed,
  });
  const elapsedMs = Date.now() - started;

  // Additionally compute the breakdown by the ORIGINAL LOCOMO category
  // (single-hop, multi-hop, temporal, open-domain, adversarial) so the
  // report matches the leaderboard's per-category rows. The rate
  // indicators are already bucketed by the rubric name in `out.byCaseType`
  // — rebuild from scratch using the native types.
  const nativeBuckets = new Map<string, { samplesProbed: number; positives: number }>();
  for (let i = 0; i < rubricProbeCases.length; i++) {
    const native = probeCases[i].type;
    const bucket = nativeBuckets.get(native) ?? { samplesProbed: 0, positives: 0 };
    bucket.samplesProbed += 1;
    nativeBuckets.set(native, bucket);
  }
  // We don't have direct access to per-case verdicts in the aggregate
  // output, but we DO have `byCaseType` bucketed by rubric name. Emit
  // both for transparency.
  const byCaseTypeRubric = Object.fromEntries(
    Object.entries(out.byCaseType).map(([k, v]) => [
      k,
      { rate: v.rate, ciLo: v.ciLo, ciHi: v.ciHi, n: v.n },
    ]),
  );

  console.log(
    JSON.stringify(
      {
        maxProbes,
        samplesProbed: out.samplesProbed,
        fpr: out.rate,
        ci: [out.ciLo, out.ciHi],
        byRubricCategory: byCaseTypeRubric,
        nativeLocomoTypeCounts: Object.fromEntries(nativeBuckets),
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
