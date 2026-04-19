/**
 * @file IBenchmark.ts
 * @description Core contract every AgentOS benchmark implements.
 *
 * A benchmark is a named collection of {@link BenchCase}s plus the logic
 * required to answer each case against an AgentOS-backed reader and score
 * the answer. External benchmarks (LongMemEval, LOCOMO, BEAM) replay a
 * haystack of conversation sessions into memory before asking the question.
 * Micro-benchmarks (DecayFidelity, HexacoEncodingBias, etc.) probe specific
 * cognitive mechanisms of the memory system directly with synthetic inputs.
 *
 * Both families share this interface so the {@link BenchmarkRunner}
 * can orchestrate, cache, and aggregate them uniformly.
 *
 * @module agentos-bench/core/IBenchmark
 */

import type { IJudge } from '../judges/IJudge.js';
import type { Cache } from './Cache.js';
import type { CostTracker } from './CostTracker.js';
import type { MemoryRetrievalProfile } from '@framers/agentos';
import type {
  RetrievalMetrics,
  LatencyBreakdown,
  StratifiedAccuracy,
  MemoryFootprint,
  TokensPerCorrect,
} from './metrics/index.js';

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

/**
 * Reader model identifier. Matches AgentOS provider:model conventions.
 */
export type ReaderModel =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'gpt-4o'
  | 'gpt-4o-mini';

/**
 * Memory mode under evaluation.
 *
 * - `full-cognitive`: full {@link CognitiveMemoryManager} with all 8 cognitive
 *   mechanisms (reconsolidation, RIF, involuntary recall, FOK, temporal gist,
 *   schema encoding, source confidence decay, emotion regulation) enabled.
 * - `base-memory`: the standalone {@link Memory} facade — no HEXACO, no PAD
 *   mood, no cognitive mechanisms, no observer/reflector. Isolates the
 *   contribution of the cognitive layer.
 * - `none`: reader sees the full haystack concatenated into its context
 *   window. The "just dump it in" baseline. Cases where the haystack
 *   exceeds the reader's context score `context-overflow` (and 0).
 */
export type MemoryMode = 'full-cognitive' | 'base-memory' | 'none';

/**
 * How a conversation haystack is fed into memory.
 *
 * - `observe`: turn-by-turn via {@link CognitiveMemoryManager.observe},
 *   mimicking real user interaction (only applies to `full-cognitive` mode).
 * - `ingest`: session-as-document via {@link Memory.ingest}, treating each
 *   session as a markdown block (both `full-cognitive` and `base-memory`).
 *
 * Replay mode is irrelevant for `none` memory mode and for benchmarks that
 * supply their own pre-extracted evidence (e.g. LongMemEval-Oracle).
 */
export type ReplayMode = 'observe' | 'ingest';

/**
 * The family a benchmark belongs to.
 *
 * - `external`: publicly-released benchmarks with haystacks and rubrics
 *   (LongMemEval, LOCOMO, BEAM).
 * - `micro`: AgentOS-specific assertions on cognitive mechanisms
 *   (DecayFidelity, HexacoEncodingBias, etc.).
 */
export type BenchmarkFamily = 'external' | 'micro';

// ---------------------------------------------------------------------------
// Case + Session
// ---------------------------------------------------------------------------

/**
 * A single conversational turn in a benchmark haystack.
 */
export interface Turn {
  /** Speaker role. */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** Textual content. Multimodal content is out of scope for v1. */
  content: string;
  /** Optional ISO timestamp — required for temporal-reasoning cases. */
  timestamp?: string;
}

/**
 * A haystack session — a dated batch of turns, as in LongMemEval and LOCOMO.
 */
export interface Session {
  /** Stable session identifier (used for citation in answer-session_ids). */
  sessionId: string;
  /** ISO date of the session. */
  date: string;
  /** Ordered turns in the session. */
  turns: Turn[];
}

/**
 * A single benchmark test case.
 *
 * For external benchmarks, `haystack` is the conversation history that must
 * be loaded into memory before `question` is asked. For micro-benchmarks,
 * `haystack` is empty and `metadata` carries the synthetic inputs.
 */
export interface BenchCase {
  /** Stable ID — must match the upstream benchmark's ID to make runs diffable. */
  id: string;
  /** Case type, used for per-type breakdown in reports.
   *  LongMemEval types: `single-session-user`, `single-session-assistant`,
   *  `multi-session`, `temporal-reasoning`, `knowledge-update`, `abstention`.
   *  Micro types: `assertion`, `ablation`, `scaling`. */
  type: string;
  /** The question to answer (external) or assertion label (micro). */
  question: string;
  /** Conversation haystack. Empty for micro-benchmarks. */
  haystack: Session[];
  /** Gold-standard answer (external) or expected assertion outcome (micro). */
  expected: string;
  /** Alternative acceptable answers (paraphrases, equivalent forms). */
  acceptableAnswers?: string[];
  /** Question date for temporal-reasoning cases (ISO). */
  questionDate?: string;
  /** Free-form metadata — micro-benchmarks stash synthetic inputs here. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Run configuration + context
// ---------------------------------------------------------------------------

/**
 * Configuration for a single benchmark run.
 */
export interface RunConfig {
  /** Reader model. */
  reader: ReaderModel;
  /** Memory mode. */
  memoryMode: MemoryMode;
  /** Replay mode. Ignored when `memoryMode === 'none'`. */
  replayMode: ReplayMode;
  /** Run at most N cases (sampling). Omit for full run. */
  sampleN?: number;
  /** Parallel case execution. Defaults to 3. */
  concurrency?: number;
  /** Abort the run if estimated USD exceeds this cap. */
  maxUsd?: number;
  /** Free-form tags attached to the run (CI, nightly, feature-branch). */
  tags?: string[];
  /** Optional seed for reproducibility where relevant. */
  seed?: number;
  /** Shared runtime retrieval profile to evaluate. */
  retrievalProfile?: MemoryRetrievalProfile;
  /** Whether retrieval engines may escalate on weak hits. */
  adaptiveRetrieval?: boolean;
  /** K for retrieval-quality metrics (Recall/Precision/NDCG@K). */
  retrievalK?: number;
  /** Enable stratified sampling + weighted accuracy. Implies per-type
   *  sampling when `samplePerType` is set. */
  stratified?: boolean;
  /** When set with `stratified`, take at most N cases per case-type. */
  samplePerType?: number;
  /** Capture brain bytes + trace counts per case. Default: true. */
  trackFootprint?: boolean;
}

/**
 * Runtime context passed to every benchmark method. Bundles the shared
 * infrastructure (judge, cache, cost tracker, working directory) so each
 * benchmark implementation only has to declare its benchmark-specific logic.
 */
export interface BenchContext {
  /** The run configuration (resolved defaults applied). */
  config: Required<
    Omit<
      RunConfig,
      | 'sampleN'
      | 'tags'
      | 'seed'
      | 'maxUsd'
      | 'retrievalProfile'
      | 'adaptiveRetrieval'
      | 'retrievalK'
      | 'stratified'
      | 'samplePerType'
      | 'trackFootprint'
    >
  > &
    Pick<
      RunConfig,
      | 'sampleN'
      | 'tags'
      | 'seed'
      | 'maxUsd'
      | 'retrievalProfile'
      | 'adaptiveRetrieval'
      | 'retrievalK'
      | 'stratified'
      | 'samplePerType'
      | 'trackFootprint'
    >;
  /** LLM-as-judge for external benchmarks. Micro-benchmarks ignore. */
  judge: IJudge;
  /** Content-hash-keyed cache for embeddings, reader responses, judgments. */
  cache: Cache;
  /** Token + USD accounting. Benchmarks must call `costTracker.record()`. */
  costTracker: CostTracker;
  /** Absolute path to the dataset cache directory. */
  dataDir: string;
  /** Absolute path to a run-scoped scratch directory (SQLite brain files, logs). */
  scratchDir: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Raw output of running one case — the model's answer plus its cost.
 * Separated from {@link CaseResult} so scoring can be re-run with an
 * updated rubric without regenerating answers.
 */
export interface CaseRun {
  caseId: string;
  /** The reader's raw answer (external) or assertion report (micro). */
  actualOutput: string;
  /** Wall-clock latency for answering this case (ms). */
  latencyMs: number;
  /** Reader prompt tokens. */
  tokensIn: number;
  /** Reader completion tokens. */
  tokensOut: number;
  /** USD cost of the reader call(s) for this case. Embedding + judge
   *  costs are tracked separately in {@link BenchResult}. */
  usd: number;
  /** Free-form details (retrieved memory snippets, trace counts, etc.). */
  metadata?: Record<string, unknown>;
  /** Error message if the case failed to produce an answer. */
  error?: string;
}

/**
 * Scored per-case result. The metrics-framework (v2) fields below are all
 * optional and populated only by benchmarks that surface them — historical
 * runs without these fields re-render via {@link compareRuns} unchanged.
 */
export interface CaseResult extends CaseRun {
  /** Normalized score (0–1). */
  score: number;
  /** Pass/fail at the benchmark's pass threshold. */
  passed: boolean;
  /** Judge reasoning or assertion detail. */
  scoreMetadata?: Record<string, unknown>;

  /**
   * Session-level retrieval-quality metrics for this case. `null` when
   * the case has no gold-session IDs (excluded from aggregate means).
   * Absent for benchmarks that do not run cognitive retrieval.
   */
  retrievalMetrics?: RetrievalMetrics | null;

  /** Per-case memory-operation timings (ms). */
  latencyBreakdown?: {
    /** Mean wall time per encode call across the case's replay. */
    encodeMs: number;
    /** End-to-end retrieve() time (CognitiveRetrievalResult.diagnostics.totalTimeMs). */
    retrieveMs: number;
    /** Vector-search subslice (CognitiveRetrievalResult.diagnostics.vectorSearchTimeMs). */
    vectorSearchMs: number;
    /** Scoring subslice (CognitiveRetrievalResult.diagnostics.scoringTimeMs). */
    scoringMs: number;
    /** Haystack replay duration (CognitiveMemoryManager ingest/observe). */
    replayMs: number;
  };

  /** Per-case memory footprint snapshot. */
  memoryFootprint?: MemoryFootprint;

  /** Per-category token breakdown for this case. */
  tokens?: {
    readerIn: number;
    readerOut: number;
    judgeIn: number;
    judgeOut: number;
    embeddingIn: number;
  };

  /**
   * Gold answer-session IDs, passed through from `case.metadata.answerSessionIds`
   * so CSV export can render the ground-truth without re-loading the dataset.
   */
  goldSessionIds?: string[];
}

/**
 * Aggregate result for a complete benchmark run.
 */
export interface BenchResult {
  /** Benchmark ID — matches {@link IBenchmark.id}. */
  benchmarkId: string;
  /** Benchmark version. */
  benchmarkVersion: string;
  /** The resolved run config. */
  config: RunConfig;
  /** Total cases attempted. */
  totalCases: number;
  /** Cases scored >= pass threshold. */
  passedCases: number;
  /** Overall accuracy (passedCases / totalCases). */
  accuracy: number;
  /** Mean score across all cases (including failures). */
  avgScore: number;
  /** Score standard deviation. */
  scoreStdDev: number;
  /** Per-type breakdown. */
  byType: Record<string, { n: number; accuracy: number; avgScore: number }>;
  /** Mean/p50/p95 latency per case (ms). */
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  /** Total reader tokens across the run. */
  totalReaderTokens: number;
  /** Total USD: reader + embedding + judge. */
  totalUsd: number;
  /** Headline efficiency metric: USD per correct answer. */
  costPerCorrect: number;
  /** ISO timestamps. */
  startedAt: string;
  completedAt: string;

  // -------------------------------------------------------------------------
  // Metrics framework (v2) aggregates — all optional, populated by benchmarks
  // that instrument them. Old run JSONs re-render without these fields.
  // -------------------------------------------------------------------------

  /**
   * Aggregate retrieval quality across all cases that had gold IDs.
   * `sampleSize` is the count used in the means (cases with `null`
   * retrievalMetrics are excluded).
   */
  retrievalMetrics?: {
    meanRecallAtK: number;
    meanPrecisionAtK: number;
    meanNdcgAtK: number;
    meanMrr: number;
    k: number;
    sampleSize: number;
  };

  /** Per-operation latency percentiles (p50/p95/p99). */
  latencyBreakdown?: LatencyBreakdown;

  /** Weighted + unweighted accuracy across case types. */
  stratifiedAccuracy?: StratifiedAccuracy;

  /** Memory footprint distribution across cases. */
  memoryFootprint?: {
    meanBrainBytes: number;
    p95BrainBytes: number;
    meanTraceCount: number;
    maxPeakWorkingMemorySlots: number;
    totalEncodeCalls: number;
  };

  /** Tokens per correct answer, per category. */
  tokensPerCorrect?: TokensPerCorrect;

  /** Per-case results. */
  cases: CaseResult[];
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

/**
 * Contract for a benchmark. Implementations live under
 * `src/benchmarks/<id>/` (external) or `src/micro/` (micro).
 *
 * Lifecycle: `setup` → `loadTestCases` → (per case: `runCase` → `scoreCase`)
 * → `aggregate`. The {@link BenchmarkRunner} owns the loop, caching, and
 * parallelism. Benchmarks are pure — they hold no mutable runner state.
 */
export interface IBenchmark {
  /** Stable benchmark identifier (kebab-case). */
  readonly id: string;
  /** Benchmark version — bumped when rubric or dataset revision changes. */
  readonly version: string;
  /** Benchmark family. */
  readonly family: BenchmarkFamily;
  /** Pass threshold in (0, 1]. Runner compares {@link CaseResult.score}. */
  readonly passThreshold: number;

  /**
   * One-time setup: download dataset, verify checksums, warm caches.
   * Idempotent — safe to call on every run.
   */
  setup(ctx: BenchContext): Promise<void>;

  /**
   * Load and return the test cases for this run. Respects
   * {@link RunConfig.sampleN} if provided.
   */
  loadTestCases(ctx: BenchContext): Promise<BenchCase[]>;

  /**
   * Produce an answer for one case (without scoring it).
   * Responsible for: replaying haystack into memory, invoking the reader,
   * cleaning up per-case resources (e.g. the SQLite brain file).
   */
  runCase(c: BenchCase, ctx: BenchContext): Promise<CaseRun>;

  /**
   * Score the answer. May call `ctx.judge` for external benchmarks or
   * return a deterministic pass/fail for micro-benchmarks.
   */
  scoreCase(c: BenchCase, run: CaseRun, ctx: BenchContext): Promise<CaseResult>;

  /**
   * Aggregate all case results into a single {@link BenchResult}.
   */
  aggregate(results: CaseResult[], ctx: BenchContext): BenchResult;
}
