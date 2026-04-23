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

export { ENGLISH_STOPWORDS, isStopword } from './stopwords.js';

export { extractHighIdfTokens } from './extractHighIdfTokens.js';

export { scoreStageRetention } from './scoreStageRetention.js';

export { computeTokenRetention } from './computeTokenRetention.js';
export type {
  TokenRetentionResult,
  TokenRetentionPerCategory,
  TokenRetentionPerCorrectness,
  TokenRetentionStageRates,
  TokenRetentionExclusion,
} from './computeTokenRetention.js';

/**
 * Cross-benchmark contract for `computeTokenRetention` consumers.
 *
 * The aggregator reads structured keys off `CaseRun.metadata`. This interface
 * documents the keys an adapter (LongMemEvalS, Locomo, Beam, future
 * benchmarks) must populate for the per-stage retention metric to fire.
 *
 * The shape is intentionally permissive — the metric tolerates missing
 * intermediate stages (e.g., a canonical-only run has no `omFinalLog`; an
 * OM-only run has no `retrievedEvidence`). Cases missing the gold answer
 * (`expected`) are silently excluded.
 *
 * Keys are non-enumerable in the runtime metadata bag (`Record<string, unknown>`)
 * but treated as canonical when present:
 *
 * - `expected` (string, REQUIRED): the gold answer text. Used to extract
 *   the high-IDF candidate-token set per case via {@link extractHighIdfTokens}.
 * - `type` / `caseType` (string, OPTIONAL): question category for per-category
 *   bucketing (e.g., `'multi-session'`, `'knowledge-update'`). Both keys
 *   are read; `type` takes precedence. Cases without either are bucketed
 *   under `'unknown'` in the per-category aggregate.
 * - `omFinalLog` (string, OPTIONAL): the post-Observer compressed observation
 *   log shown to the reader. Used to compute the `raw → observer` retention
 *   rate. Absent on non-OM runs.
 * - `retrievedEvidence` (RetentionRetrievedEvidence[], OPTIONAL): the ranked
 *   retrieved-passage list from the retriever stage. Used to compute the
 *   `raw → retrieved` retention rate. Absent on OM-only runs without
 *   retrieval.
 * - `expectedSessionIds` / `goldSessionIds` (string[], OPTIONAL — used by
 *   other metrics, not retention itself).
 *
 * The `CaseRun.success` field (boolean) is used for the per-correctness
 * split; the metric reads it directly off the case, not metadata.
 */
export interface RetentionInputs {
  /** Gold answer text. REQUIRED for the case to participate in retention scoring. */
  expected: string;
  /** Question category (e.g., 'multi-session'). Used for per-category bucketing. */
  type?: string;
  /** Legacy alias for `type`. Read iff `type` is missing. */
  caseType?: string;
  /** Post-Observer compressed observation log shown to the reader (OM runs only). */
  omFinalLog?: string;
  /** Retrieved passages from the retriever stage (canonical / OM+retrieval runs). */
  retrievedEvidence?: RetentionRetrievedEvidence[];
}

/**
 * Minimal shape `computeTokenRetention` reads from each retrieved-evidence
 * entry. The full `EvidenceTrace` interface in
 * {@link EvidenceProvenance} carries more fields; only `content` is
 * required for retention scoring.
 */
export interface RetentionRetrievedEvidence {
  /** The retrieved passage's text. */
  content: string;
}
