/**
 * @file Beam.ts
 * @description BEAM benchmark adapter placeholder.
 *
 * BEAM ("Beyond a Million Tokens", ICLR 2026) is the benchmark where
 * Hindsight holds SOTA (64.1% at the 10M-token tier, 58% margin over the
 * next-best published result). The paper is at arxiv.org/abs/2510.27246
 * and results are hosted at agentmemorybenchmark.ai/dataset/beam.
 *
 * The upstream dataset schema is not yet publicly documented in enough
 * detail for a non-speculative adapter. Implementing this adapter
 * requires either:
 *
 *   1. The official JSON / JSONL data files with a locked schema, or
 *   2. A ground-truth reference implementation to mirror.
 *
 * Both routes depend on the vectorize-io/agent-memory-benchmark repo
 * publishing the dataset under an explicit license. When that happens,
 * this file is intended to be extended with:
 *
 *   - `loadBeamDataset(dataDir, tier)` in `./dataset.ts`
 *   - Three tier-specific subclasses (`BeamCase500k`, `BeamCase1M`, `BeamCase10M`)
 *   - Rubric vendoring in `src/judges/rubrics/beam.ts` if BEAM uses its
 *     own judge prompt (likely; the published 10M SOTA row implies a
 *     sturdy scoring pipeline).
 *
 * Until then, instantiating any `BeamCase*` class and asking it to run
 * surfaces an `unimplemented` error with a pointer back to the upstream
 * documentation. The adapter IS wired into the CLI registry as
 * `beam-placeholder` so its status is visible, but the runner refuses
 * to produce numbers.
 *
 * @module agentos-bench/benchmarks/beam/Beam
 */

import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../../core/IBenchmark.js';
import type { IReader } from '../../readers/IReader.js';

/** Target tier in the 100K → 10M token ladder. */
export type BeamTier = '500k' | '1m' | '10m';

/** Options for constructing a BEAM adapter. Kept minimal intentionally. */
export interface BeamAdapterOptions {
  reader: IReader;
  tier: BeamTier;
}

/**
 * Sentinel thrown when BEAM is invoked before its schema is wired up.
 * Exported so upstream tests can assert against it.
 */
export class BeamUnimplementedError extends Error {
  constructor(tier: BeamTier) {
    super(
      `BEAM ${tier} adapter is not yet implemented — the upstream dataset schema ` +
        `has not been publicly documented in a form suitable for a faithful ` +
        `reimplementation. See packages/agentos-bench/src/benchmarks/beam/Beam.ts ` +
        `for the extension checklist.`,
    );
    this.name = 'BeamUnimplementedError';
  }
}

/**
 * BEAM placeholder adapter. All lifecycle methods throw
 * {@link BeamUnimplementedError}.
 */
export class Beam implements IBenchmark {
  readonly id: string;
  readonly version = '0.0.0-placeholder';
  readonly family = 'external' as const;
  readonly passThreshold = 0.5;

  constructor(private readonly opts: BeamAdapterOptions) {
    this.id = `beam-${opts.tier}`;
  }

  async setup(_ctx: BenchContext): Promise<void> {
    throw new BeamUnimplementedError(this.opts.tier);
  }

  async loadTestCases(_ctx: BenchContext): Promise<BenchCase[]> {
    throw new BeamUnimplementedError(this.opts.tier);
  }

  async runCase(_c: BenchCase, _ctx: BenchContext): Promise<CaseRun> {
    throw new BeamUnimplementedError(this.opts.tier);
  }

  async scoreCase(_c: BenchCase, _run: CaseRun, _ctx: BenchContext): Promise<CaseResult> {
    throw new BeamUnimplementedError(this.opts.tier);
  }

  aggregate(_results: CaseResult[], _ctx: BenchContext): BenchResult {
    throw new BeamUnimplementedError(this.opts.tier);
  }
}
