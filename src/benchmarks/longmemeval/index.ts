/**
 * @file benchmarks/longmemeval/index.ts
 * @description Barrel export for the LongMemEval adapter family.
 *
 * `LongMemEvalS` / `LongMemEvalM` / `LongMemEvalOracle` are convenience
 * subclasses that preselect the dataset variant. They share the entire
 * pipeline implementation — the only difference is which JSON file
 * gets loaded from `<dataDir>/longmemeval/`.
 */

import { LongMemEvalS, type LongMemEvalAdapterOptions } from './LongMemEvalS.js';
import type { IReader } from '../../readers/IReader.js';

export { LongMemEvalS };
export type { LongMemEvalAdapterOptions };
export { loadLongMemEvalDataset } from './dataset.js';
export type { LongMemEvalVariant, RawLongMemEvalCase } from './dataset.js';

/**
 * LongMemEval-M — medium variant (~500 sessions per haystack).
 * Same adapter logic as `LongMemEvalS`, different dataset file.
 */
export class LongMemEvalM extends LongMemEvalS {
  constructor(opts: Omit<LongMemEvalAdapterOptions, 'variant'> & { reader: IReader }) {
    super({ ...opts, variant: 'm' });
  }
}

/**
 * LongMemEval-Oracle — evidence-only variant. Tests reader quality
 * independent of retrieval. Haystacks contain only the sessions
 * required to answer the question. Replay mode is effectively fixed.
 */
export class LongMemEvalOracle extends LongMemEvalS {
  constructor(opts: Omit<LongMemEvalAdapterOptions, 'variant'> & { reader: IReader }) {
    super({ ...opts, variant: 'oracle' });
  }
}
