/**
 * @file metrics/index.ts
 * @description Barrel for bench metric helpers.
 *
 * @module agentos-bench/core/metrics
 */

export { computeRetrievalMetrics } from './computeRetrievalMetrics.js';
export type {
  RetrievalMetrics,
  RetrievalMetricsInput,
} from './computeRetrievalMetrics.js';

export {
  computeStratifiedAccuracy,
  LONGMEMEVAL_S_PRIORS,
} from './computeStratifiedAccuracy.js';
export type { StratifiedAccuracy } from './computeStratifiedAccuracy.js';

export { computeLatencyBreakdown } from './computeLatencyBreakdown.js';
export type {
  LatencyBreakdown,
  LatencyOpSamples,
  LatencyOpStats,
} from './computeLatencyBreakdown.js';

export { computeMemoryFootprint } from './computeMemoryFootprint.js';
export type {
  MemoryFootprint,
  MemoryFootprintProbe,
} from './computeMemoryFootprint.js';

export { computeTokenEfficiency } from './computeTokenEfficiency.js';
export type { TokensPerCorrect } from './computeTokenEfficiency.js';

export { computeBootstrapCI } from './computeBootstrapCI.js';
export type { BootstrapResult, BootstrapOptions } from './computeBootstrapCI.js';

export {
  computeJudgeAdversarialRate,
  synthesizeAdversarialAnswer,
  ADVERSARIAL_SYNTH_VERSION,
} from './computeJudgeAdversarial.js';
export type {
  AdversarialSynthInput,
  AdversarialSynthOutput,
  AdversarialRateInput,
  AdversarialRateOutput,
  AdversarialProbeCase,
} from './computeJudgeAdversarial.js';

export { computePairedMcNemar } from './computePairedMcNemar.js';
export type { McNemarResult } from './computePairedMcNemar.js';

export { computeEvidenceProvenance } from './computeEvidenceProvenance.js';
export type {
  EvidenceProvenance,
  EvidenceTrace,
} from './computeEvidenceProvenance.js';

export { computeRetrievalStageMetrics } from './computeRetrievalStageMetrics.js';
export type {
  RetrievalStageMetrics,
  StageName,
  StageRankedIds,
  StageMetric,
} from './computeRetrievalStageMetrics.js';
