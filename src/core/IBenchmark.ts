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
  | 'gpt-4o-mini'
  | 'gpt-5-mini';

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
  /**
   * Name of a retrieval signal to zero for this run. When set, the
   * matching weight in `CognitiveRetrievalOptions.scoringWeights` is
   * forced to 0; the remaining five keep their default weights.
   * Applies only to full-cognitive memory mode.
   */
  ablateSignal?:
    | 'strength'
    | 'similarity'
    | 'recency'
    | 'emotionalCongruence'
    | 'graphActivation'
    | 'importance';
  /**
   * Name of a cognitive mechanism to disable for this run. Passed
   * through to `CognitiveMemoryConfig.cognitiveMechanisms.<name>.enabled
   * = false` on the scratch manager.
   */
  ablateMechanism?:
    | 'reconsolidation'
    | 'retrievalInducedForgetting'
    | 'involuntaryRecall'
    | 'metacognitiveFOK'
    | 'temporalGist'
    | 'schemaEncoding'
    | 'sourceConfidenceDecay'
    | 'emotionRegulation';

  /**
   * Optional neural reranker. When set, the full-cognitive path wires
   * a {@link RerankerService} into the scratch
   * {@link CognitiveMemoryManager}; retrieve blends 0.7 cognitive +
   * 0.3 neural cross-encoder scores. Bench side also expands the
   * retrieval candidate pool (by `candidateMultiplier`, default 3) so
   * the reranker has meaningfully more candidates than the final
   * reader K, then truncates to the reader K before prompt assembly.
   *
   * `apiKey` resolves from the CLI flag or `COHERE_API_KEY` env when
   * omitted.
   */
  rerank?: {
    provider: 'cohere';
    model?: string;
    apiKey?: string;
    /**
     * Multiply the retrieval `topK` before rerank to widen the
     * candidate pool. Default 3 when `rerank` is set, 1 otherwise.
     */
    candidateMultiplier?: number;
  };

  /**
   * Model id used to generate session-level contextual-retrieval
   * summaries (Anthropic Sep 2024 variant). The CLI constructs a
   * {@link SessionSummarizer} around this model and passes it to
   * the adapter via `entry.build({ sessionSummarizer })`. Recorded
   * on {@link BenchContext.config} so {@link BenchmarkRunner}'s
   * case-run cache key can fingerprint it — a cached cognitive-only
   * run must not satisfy a request for a contextual run.
   *
   * Undefined when the `--context-summary` flag was not set.
   */
  contextSummaryModel?: string;

  /**
   * How many retrieved chunks the reader sees after rerank and
   * score-floor filtering. Fed into `runFullCognitiveCase` /
   * `runBaseMemoryCase` as the `recallTopK` arg. When rerank is
   * active, the candidate pool scales automatically via
   * `rerank.candidateMultiplier` (default 3×): K=15 → 45-chunk
   * Cohere input, K=20 → 60-chunk input. Must be >= 1 when set.
   * Omit to inherit the adapter's default (currently 10).
   *
   * Resolved from the `--reader-top-k` CLI flag. Recorded on
   * {@link BenchContext.config} so {@link BenchmarkRunner}'s
   * case-run cache key can fingerprint it — K=10 and K=15 runs
   * must not satisfy each other's cached answers.
   */
  readerTopK?: number;

  /**
   * Enable the judge-adversarial probe. When true, the runner
   * synthesizes topically-adjacent wrong answers for up to
   * {@link RunConfig.judgeAdversarialMaxProbes} cases and scores them
   * with the same judge that scored real answers, reporting the
   * false-positive rate on {@link BenchResult.judgeAdversarialFPR}.
   *
   * Motivated by the Penfield Labs LoCoMo audit (Apr 2026) which found
   * the default LoCoMo judge accepts ~63 percent of plausible wrong
   * answers — a noise floor invisible without this probe. Cost: one
   * cheap synth call plus one judge call per probed case, bounded by
   * `judgeAdversarialMaxProbes`.
   *
   * Default: false.
   */
  judgeAdversarial?: boolean;

  /**
   * Maximum cases probed when {@link RunConfig.judgeAdversarial} is
   * enabled. Hard-bounds the cost (and latency) the probe can add to
   * a run. Default: 50.
   */
  judgeAdversarialMaxProbes?: number;

  /**
   * Synthesizer model used to generate adversarial distractors. A
   * cheap model suffices (the probe is about judge behavior, not
   * synthesizer behavior). Default: `'gpt-5-mini'`.
   */
  judgeAdversarialSynthModel?: string;

  /**
   * Bootstrap resamples for all CI fields
   * ({@link BenchResult.accuracyCI}, `weightedAccuracyCI`,
   * `byTypeCI`, `judgeAdversarialFPR`). Default: 10,000.
   */
  bootstrapResamples?: number;

  /**
   * Enable Step-2 session-level hierarchical retrieval. When true, the
   * bench adapter constructs a `SessionRetriever` (backed by a
   * dedicated `SessionSummaryStore`) and uses it in place of
   * `CognitiveMemoryManager.retrieve` for full-cognitive cases.
   *
   * Default: false. Opt-in behind the `--session-retrieval` CLI flag.
   */
  sessionRetrieval?: boolean;

  /**
   * K for Stage-1: number of sessions selected by summary similarity.
   * Ignored when {@link RunConfig.sessionRetrieval} is false.
   * Default: 5.
   */
  sessionRetrievalTopSessions?: number;

  /**
   * M for Stage-2: number of chunks taken per Stage-1 session before
   * merging. Ignored when {@link RunConfig.sessionRetrieval} is false.
   * Default: 3.
   */
  sessionRetrievalChunksPerSession?: number;

  /**
   * Enable Step-3 hybrid BM25 + dense RRF retrieval. Mutually
   * exclusive with `sessionRetrieval` in Step 3 MVP — setting both
   * throws a documented error inside `runFullCognitiveCase`.
   * Default: false. Opt-in behind `--hybrid-retrieval` CLI flag.
   */
  hybridRetrieval?: boolean;

  /**
   * Enable Step-4 HyDE (Hypothetical Document Embedding) retrieval.
   * When true, the bench constructs a cheap LLM invoker and wires it
   * into `CognitiveMemoryManager` via `featureDetectionLlmInvoker`;
   * the manager then auto-constructs a `MemoryHydeRetriever`. The
   * adapter additionally threads the hyde retriever into
   * `HybridRetriever` when `--hybrid-retrieval` is also set, so the
   * hypothesis queries BOTH dense and sparse sides while rerank
   * uses the ORIGINAL user query.
   *
   * Orthogonal to `sessionRetrieval` and `hybridRetrieval`.
   * Default: false. Opt-in behind `--hyde` CLI flag.
   */
  hyde?: boolean;

  /**
   * Enable Step-5 FactSupersession post-retrieval filter. When true,
   * the bench adapter builds a cheap LLM invoker (wrapping the main
   * reader) and runs `FactSupersession.resolve()` over retrieved
   * traces before feeding them to the reader. Orthogonal to other
   * retrieval flags — combinable with `--hybrid-retrieval`.
   *
   * Default: false. Opt-in behind `--fact-supersession` CLI flag.
   */
  factSupersession?: boolean;

  /**
   * Enable Step-6 split-on-ambiguous rerank refinement. Bottom fraction
   * of traces by first-pass rerank score are split at sentence
   * boundaries and rescored; replaced by their better half only if
   * it outscores the original. Monotonic. Reuses the existing Cohere
   * rerank-v3.5 service — no extra LLM calls.
   *
   * Value in (0, 1]. Typical: 0.3 (refine bottom 30%).
   * Default: undefined (no split). Requires `--hybrid-retrieval`.
   */
  splitAmbiguous?: number;

  /**
   * Enable Step-7 Observer/Reflector pipeline (Tier 2 progressive
   * enhancement). When true, the bench adapter routes every
   * conversation turn through `manager.observe()` in addition to
   * `manager.encode()`. The observer extracts personality-biased
   * notes at 30k-token buffer intervals, compresses them at 50-note
   * intervals, and the reflector consolidates compressed observations
   * into long-term traces with supersession semantics when reflection
   * threshold (40k tokens) is reached. Reflection-derived traces are
   * encoded into the same MemoryStore the HybridRetriever queries.
   *
   * Default: false. Opt-in behind `--observer-reflector` CLI flag.
   * Observer/reflector LLM invoker defaults to gpt-5-mini (summarization
   * doesn't need the reader's quality; Mastra uses gpt-5-mini too).
   */
  observerReflector?: boolean;

  /**
   * Step-8 (Tier 2 fix): REPLACEMENT semantics for Observer/Reflector.
   * When true AND `observerReflector` is also true:
   *   1. Raw chunks are NOT encoded via timedEncode during replay.
   *   2. After each session's turns are observed, adapter calls
   *      `manager.flushReflection(neutralMood)` to force reflection traces.
   *   3. Encoded reflection-trace IDs are indexed into hybrid BM25.
   *
   * Requires `observerReflector: true`. Default: false.
   */
  observerReflectorReplace?: boolean;

  /**
   * Step-9 (Tier 3): Mem0-style fact-graph ingest. When true, the bench
   * adapter builds a per-case `FactStore` at session-ingest time using a
   * gpt-5-mini extractor, extracts `(subject, predicate, object, timestamp)`
   * tuples with a closed 25-predicate schema, and threads the store into
   * the `HybridRetriever`. At query time, synthetic fact-graph traces
   * (retrievalScore: 1.0, sourceType: 'fact_graph') are prepended to the
   * merged pool BEFORE rerank so the blend can still downrank them if
   * they're not relevant.
   *
   * Preserves literal `object` tokens where summary-based approaches
   * (Steps 5 FactSupersession, 7/8 Observer/Reflector) paraphrased them
   * away. Mutually exclusive with `observerReflector*` flags.
   *
   * Default: false. Opt-in behind `--fact-graph-ingest` CLI flag.
   */
  factGraphIngest?: boolean;
  /**
   * Step 13: enable graph-activation wire-up. When true the bench runs
   * `extractEntities` at every `manager.encode` call (populating
   * `MemoryTrace.entities`) and configures the underlying `MemoryStore`
   * with `enableGraphActivation: true` so ingest creates entity nodes
   * + co-occurrence edges and retrieve computes per-candidate spreading
   * activation scores (weight 0.10 in `RetrievalPriorityScorer`,
   * previously a silent zero).
   *
   * Default: false. Opt-in behind `--graph-activation` CLI flag.
   */
  graphActivation?: boolean;
  /**
   * Step 14: enable the Emergence-style two-call reader. When true, the
   * bench splits each case's single reader.invoke into an extract call
   * (raw retrieved passages -> JSON fact scratchpad with passage-id
   * citations) followed by an answer call (scratchpad only -> final
   * answer). Both calls use `config.reader`. Default: false (single-call).
   */
  twoCallReader?: boolean;
  /**
   * Step 15: enable Mastra-style Observational Memory. When true, the
   * bench DISABLES the retrieval pipeline entirely (no HybridRetriever,
   * no rerank, no top-K). Ingest runs an Observer LLM over each session
   * to produce dated, priority-tagged observations, with a Reflector
   * pass if the accumulated log exceeds the 40k-token threshold. The
   * reader sees the full consolidated observation log in its system
   * prompt plus the question — no retrieval. Default: false.
   */
  observationalMemory?: boolean;
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
      | 'ablateSignal'
      | 'ablateMechanism'
      | 'rerank'
      | 'contextSummaryModel'
      | 'readerTopK'
      | 'judgeAdversarial'
      | 'judgeAdversarialMaxProbes'
      | 'judgeAdversarialSynthModel'
      | 'bootstrapResamples'
      | 'sessionRetrieval'
      | 'sessionRetrievalTopSessions'
      | 'sessionRetrievalChunksPerSession'
      | 'hybridRetrieval'
      | 'hyde'
      | 'factSupersession'
      | 'splitAmbiguous'
      | 'observerReflector'
      | 'observerReflectorReplace'
      | 'factGraphIngest'
      | 'graphActivation'
      | 'twoCallReader'
      | 'observationalMemory'
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
      | 'ablateSignal'
      | 'ablateMechanism'
      | 'rerank'
      | 'contextSummaryModel'
      | 'readerTopK'
      | 'judgeAdversarial'
      | 'judgeAdversarialMaxProbes'
      | 'judgeAdversarialSynthModel'
      | 'bootstrapResamples'
      | 'sessionRetrieval'
      | 'sessionRetrievalTopSessions'
      | 'sessionRetrievalChunksPerSession'
      | 'hybridRetrieval'
      | 'hyde'
      | 'factSupersession'
      | 'splitAmbiguous'
      | 'observerReflector'
      | 'observerReflectorReplace'
      | 'factGraphIngest'
      | 'graphActivation'
      | 'twoCallReader'
      | 'observationalMemory'
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

  /**
   * Shingle-based max-overlap evidence trace attributed to the reader's
   * answer. `null` explicitly means the case ran the provenance pass but
   * no retrieved trace matched >=1 shingle with the answer. `undefined`
   * means the case did not run the provenance pass at all (legacy runs
   * or benchmarks that don't surface it).
   *
   * Populated per-case inside the benchmark adapter after the reader
   * emits its answer; aggregated into {@link BenchResult.evidenceOrigin}
   * by the runner.
   */
  evidenceUsed?: {
    traceId: string;
    sourceType: string;
    overlapScore: number;
  } | null;

  /**
   * Per-retrieval-stage quality metrics (dense → sparse → merged →
   * reranked → final) computed against this case's gold session IDs.
   * `null` when the case ran retrieval but had no gold to score
   * against (excluded from aggregate means). `undefined` when the
   * benchmark didn't surface the stage-level view (legacy runs or
   * non-hybrid retrieval paths).
   */
  retrievalStageMetrics?: import('./metrics/index.js').RetrievalStageMetrics | null;
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

  /**
   * 95 percent bootstrap percentile CI for unweighted accuracy.
   * Populated by the runner after the benchmark's own `aggregate()`
   * returns. Always present on runs that complete; absent on legacy
   * run JSONs written before Step 1 of the sequenced RAG rollout.
   */
  accuracyCI?: import('./metrics/index.js').BootstrapResult;

  /**
   * 95 percent bootstrap CI for {@link BenchResult.stratifiedAccuracy}'s
   * `weightedOverall`. Absent when the run did not compute a stratified
   * accuracy.
   */
  weightedAccuracyCI?: import('./metrics/index.js').BootstrapResult;

  /**
   * Per-case-type bootstrap CI over accuracy. Same keys as
   * {@link BenchResult.byType}. Absent on legacy runs.
   */
  byTypeCI?: Record<string, import('./metrics/index.js').BootstrapResult>;

  /**
   * Judge-adversarial probe result when
   * {@link RunConfig.judgeAdversarial} was enabled. Reports the
   * false-positive rate of the judge on topically-adjacent wrong
   * answers — a measured noise floor below which step-level
   * improvement claims are not defensible.
   */
  judgeAdversarialFPR?: import('./metrics/index.js').AdversarialRateOutput;

  /**
   * Aggregate of {@link CaseResult.evidenceUsed}.sourceType across cases.
   * Counts the number of cases where each source type was the
   * max-overlap provenance; a `none` bucket captures cases where the
   * provenance pass ran but no retrieved trace matched. Absent when no
   * case carried `evidenceUsed` (i.e., benchmarks or legacy runs that
   * don't surface provenance).
   */
  evidenceOrigin?: Record<string, number>;

  /**
   * Mean per-stage retrieval quality across cases that carried a
   * {@link CaseResult.retrievalStageMetrics}. Splits what used to be a
   * single end-to-end metric into dense / sparse / merged / reranked /
   * final. Absent when no case surfaced stage-level metrics.
   */
  retrievalStageMetrics?: import('./metrics/index.js').RetrievalStageMetrics;

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
