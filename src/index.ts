/**
 * @file index.ts
 * @description Public entry point for `@framers/agentos-bench`.
 *
 * @example Running the DecayFidelity micro-benchmark
 * ```ts
 * import { BenchmarkRunner, DecayFidelity } from '@framers/agentos-bench';
 * const runner = new BenchmarkRunner({ dataDir, resultsDir, judge });
 * const result = await runner.run(new DecayFidelity(), {
 *   reader: 'claude-sonnet-4-6',
 *   memoryMode: 'none',
 *   replayMode: 'ingest',
 * });
 * console.log(result.accuracy); // 1.0 on unmodified AgentOS
 * ```
 */

export * from './core/index.js';

// --- Judges ---
export type { IJudge, JudgeInput, JudgeOutput } from './judges/IJudge.js';
export { LongMemEvalJudge } from './judges/LongMemEvalJudge.js';
export type { LongMemEvalJudgeOptions } from './judges/LongMemEvalJudge.js';
export {
  buildJudgePrompt,
  parseJudgeReply,
  RUBRIC_SOURCE,
  RUBRIC_VERSION,
} from './judges/rubrics/longmemeval.js';
export type { LongMemEvalQuestionType } from './judges/rubrics/longmemeval.js';

// --- Readers ---
export type { IReader, ReaderRequest, ReaderResponse } from './readers/IReader.js';
export { MockReader } from './readers/MockReader.js';
export type { MockHandler, MockRoute } from './readers/MockReader.js';
export { createReader, OpenAIHttpReader, AnthropicHttpReader } from './readers/createReader.js';

// --- External benchmarks ---
export * from './benchmarks/longmemeval/index.js';
export * from './benchmarks/locomo/index.js';

// --- Reporting ---
export * from './reporting/index.js';

// --- Micro-benchmarks ---
export { DecayFidelity, buildSyntheticTrace } from './micro/DecayFidelity.js';
export { HexacoEncodingBias } from './micro/HexacoEncodingBias.js';
export { WorkingMemoryCapacity } from './micro/WorkingMemoryCapacity.js';
export { SpreadingActivationPrecision, buildSyntheticGraph } from './micro/SpreadingActivationPrecision.js';
export { ConsolidationSignalPreservation } from './micro/ConsolidationSignalPreservation.js';
export { ScalingProfile } from './micro/ScalingProfile.js';
export { MinimalWorkingMemoryBacking } from './micro/support/MinimalWorkingMemoryBacking.js';
