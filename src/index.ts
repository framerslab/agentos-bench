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
export type { IJudge, JudgeInput, JudgeOutput } from './judges/IJudge.js';

// --- Micro-benchmarks ---
export { DecayFidelity, buildSyntheticTrace } from './micro/DecayFidelity.js';
export { HexacoEncodingBias } from './micro/HexacoEncodingBias.js';
export { WorkingMemoryCapacity } from './micro/WorkingMemoryCapacity.js';
export { SpreadingActivationPrecision, buildSyntheticGraph } from './micro/SpreadingActivationPrecision.js';
export { ConsolidationSignalPreservation } from './micro/ConsolidationSignalPreservation.js';
export { ScalingProfile } from './micro/ScalingProfile.js';
export { MinimalWorkingMemoryBacking } from './micro/support/MinimalWorkingMemoryBacking.js';
