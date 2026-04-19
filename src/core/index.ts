/**
 * @file core/index.ts
 * @description Barrel export for the core runtime of the bench suite.
 *
 * Public consumers should import from `@framers/agentos-bench` or from
 * `@framers/agentos-bench/core` rather than reaching into individual
 * files — internal paths are not considered stable.
 */

export type {
  BenchCase,
  BenchContext,
  BenchResult,
  BenchmarkFamily,
  CaseResult,
  CaseRun,
  IBenchmark,
  MemoryMode,
  ReaderModel,
  ReplayMode,
  RunConfig,
  Session,
  Turn,
} from './IBenchmark.js';

export { Cache, hashKey } from './Cache.js';
export { CostTracker, MODEL_PRICES } from './CostTracker.js';
export type { CostEntry, CostTotals } from './CostTracker.js';
export { ResultStore } from './ResultStore.js';
export type { ResultsSummary, SummaryEntry } from './ResultStore.js';
export { BenchmarkRunner, resolveRunConfig } from './BenchmarkRunner.js';
export type { BenchmarkRunnerOptions } from './BenchmarkRunner.js';
export { compareRuns, formatComparisonMarkdown } from './compareRuns.js';
export type {
  CaseDelta,
  ComparisonWinner,
  RunComparison,
  TypeComparison,
  UnmatchedCases,
} from './compareRuns.js';
export { estimateRunCost } from './estimateRunCost.js';
export type { CostEstimate, EstimateRunCostInput } from './estimateRunCost.js';
export {
  replay,
  replayViaObserve,
  replayViaIngest,
  formatSessionAsMarkdown,
  buildHaystackContext,
} from './ConversationReplay.js';
export type { ReplayStats } from './ConversationReplay.js';
export { percentile, stdDev, mean } from './statsUtil.js';
