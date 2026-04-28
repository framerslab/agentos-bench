#!/usr/bin/env node
/**
 * @file cli.ts
 * @description Command-line interface for `@framers/agentos-bench`.
 *
 * Subcommands:
 *   - `run <benchmark-id> [--reader <model>] [--memory <mode>] [--replay <mode>] [--sample N]`
 *   - `list`    — enumerate built-in benchmarks
 *   - `setup`   — prepare dataset caches (placeholder — downloads via HF hub in v2)
 *   - `leaderboard` — regenerate results/LEADERBOARD.md (stub until leaderboard generator ships)
 *
 * Environment variables:
 *   - `AGENTOS_BENCH_DATA_DIR`    (default: ./data)
 *   - `AGENTOS_BENCH_RESULTS_DIR` (default: ./results)
 *   - `AGENTOS_BENCH_TIER`        micro | s | m | full  (informational for now)
 *   - `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
 *
 * @module agentos-bench/cli
 */

import path from 'node:path';
import { Command } from 'commander';

import {
  Beam,
  BenchmarkRunner,
  ConsolidationSignalPreservation,
  DecayFidelity,
  HexacoEncodingBias,
  Locomo,
  LongMemEvalJudge,
  LongMemEvalM,
  LongMemEvalOracle,
  LongMemEvalS,
  MockReader,
  ScalingProfile,
  SignalAblation,
  SpreadingActivationPrecision,
  WorkingMemoryCapacity,
  CachedEmbedder,
  createOpenAIEmbedderFromEnv,
  createReader,
  estimateRunCost,
  type IBenchmark,
  type IReader,
  type MemoryMode,
  type ReaderModel,
  type ReplayMode,
  type RunConfig,
} from './index.js';
import type { IEmbeddingManager } from '@framers/agentos/core/embeddings/IEmbeddingManager';
import type { MemoryRetrievalProfile } from '@framers/agentos';
import { SessionSummarizer } from '@framers/agentos/memory';

interface BenchEntry {
  id: string;
  family: 'external' | 'micro';
  description: string;
  /**
   * Build the benchmark instance. `reader` is an already-constructed
   * {@link IReader} — real (OpenAI / Anthropic HTTP client) in
   * production runs, {@link MockReader} under `--dry-run`.
   * `embedder`, when provided, replaces the CharHashEmbedder stub in
   * the full-cognitive path so retrieval exercises real semantic
   * similarity.
   */
  build: (ctx: {
    reader: IReader;
    /**
     * Optional auxiliary reader pool for the per-category reader-tier
     * router (`--reader-router`). When set, the bench dispatches the
     * answer reader per case based on the gpt-5-mini classifier's
     * predicted category. Falls back to {@link reader} when the
     * dispatched tier isn't in the pool.
     */
    readerByTier?: Partial<Record<'gpt-4o' | 'gpt-5-mini', IReader>>;
    embedder?: IEmbeddingManager;
    /**
     * Optional session-level contextual-retrieval summarizer. When
     * `--context-summary` is set on the CLI, the CLI constructs a
     * {@link SessionSummarizer} (from `@framers/agentos/memory`) and
     * passes it here so the adapter can thread it through its ingest
     * path. Most adapters (micro-benchmarks, LongMemEval-none) ignore it.
     */
    sessionSummarizer?: SessionSummarizer;
    /**
     * Step-2: optional session-level retrieval store. When
     * `--session-retrieval` is set, the CLI constructs a
     * {@link SessionSummaryStore} and passes it here so the adapter
     * indexes summaries during replay AND constructs a
     * {@link SessionRetriever} per-case for the retrieval step.
     */
    sessionSummaryStore?: import('@framers/agentos/memory').SessionSummaryStore;
    /** Step-2: Stage-1 session count (default 5 on the adapter side). */
    sessionRetrievalTopSessions?: number;
    /** Step-2: Stage-2 chunks-per-session (default 3 on the adapter side). */
    sessionRetrievalChunksPerSession?: number;
    /**
     * Step-3: when true, the adapter constructs a per-case
     * `HybridRetriever` and uses it in place of `manager.retrieve`.
     * Mutually exclusive with `sessionSummaryStore`.
     */
    hybridRetrievalEnabled?: boolean;
    /**
     * Step-4: when true, the adapter constructs a cheap LLM invoker
     * (reuses the main reader) and wires HyDE through the manager
     * and, if applicable, through the `HybridRetriever`.
     */
    hydeEnabled?: boolean;
    /**
     * Step-5: when true, the adapter constructs a `FactSupersession`
     * (using the main reader as the LLM invoker) and runs it on
     * retrieved traces before feeding them to the reader.
     */
    factSupersessionEnabled?: boolean;
    /**
     * Step-6: threshold for split-on-ambiguous rerank refinement. When
     * > 0, the adapter passes this to `HybridRetriever`'s
     * `splitAmbiguousThreshold` option. Typical: 0.3. Requires
     * `hybridRetrievalEnabled: true`.
     */
    splitAmbiguousThreshold?: number;
    /**
     * Step-7 (Tier 2): when true, the adapter constructs a cost-tracked
     * gpt-5-mini invoker and wires Observer/Reflector through
     * `createCognitiveManager`, then routes each conversation turn
     * through `manager.observe()` in addition to `manager.encode()`.
     */
    observerReflectorEnabled?: boolean;
    /**
     * Step-8: REPLACEMENT semantics for Observer/Reflector (Tier 2 fix).
     * Requires `observerReflectorEnabled: true`. When true, adapter skips
     * raw chunk encoding, calls `manager.flushReflection()` at session
     * boundaries, and indexes reflection-trace IDs into BM25.
     */
    observerReflectorReplaceEnabled?: boolean;
    /**
     * Step-9 (Tier 3): when true, the adapter constructs a cost-tracked
     * gpt-5-mini invoker and wires a Mem0-style fact-graph through
     * `createCognitiveManager`. Per-session fact extraction runs at
     * ingest; synthetic fact-graph traces (retrievalScore: 1.0,
     * sourceType: 'fact_graph') are prepended to the HybridRetriever
     * merged pool BEFORE rerank. Mutually exclusive with
     * `observerReflectorEnabled` (enforced at RunConfig level).
     */
    factGraphIngestEnabled?: boolean;
    /**
     * Step-13: when true, the adapter extracts entities via regex at
     * every `manager.encode` call (populating `trace.entities`) and
     * passes `enableGraphActivation: true` to `createCognitiveManager`
     * so the internal `MemoryStore` upserts entity nodes + co-occurrence
     * edges and computes spreading activation at retrieve.
     */
    graphActivationEnabled?: boolean;
    /**
     * Step-15: when true, the adapter bypasses retrieval entirely and
     * runs Mastra-style Observational Memory ingest (Observer LLM per
     * session + optional Reflector pass) before each case query. The
     * reader sees the consolidated observation log + question in a
     * single call.
     */
    observationalMemoryEnabled?: boolean;
  }) => IBenchmark;
}

const BENCHMARKS: BenchEntry[] = [
  {
    id: 'decay-fidelity',
    family: 'micro',
    description: 'Ebbinghaus decay curve conformance at 1d/5d/10d/30d/60d probes',
    build: () => new DecayFidelity(),
  },
  {
    id: 'hexaco-encoding-bias',
    family: 'micro',
    description: 'HEXACO traits bias encoding in the documented direction',
    build: () => new HexacoEncodingBias(),
  },
  {
    id: 'working-memory-capacity',
    family: 'micro',
    description: 'Baddeley 5-9 slot capacity + LRU-by-activation eviction',
    build: () => new WorkingMemoryCapacity(),
  },
  {
    id: 'spreading-activation-precision',
    family: 'micro',
    description: 'Anderson spreading activation contains ≥80% of seed cluster',
    build: () => new SpreadingActivationPrecision(),
  },
  {
    id: 'consolidation-signal-preservation',
    family: 'micro',
    description: 'Flashbulb-immunity invariant across reconsolidation, RIF, emotion regulation',
    build: () => new ConsolidationSignalPreservation(),
  },
  {
    id: 'scaling-profile',
    family: 'micro',
    description: 'Retrieval scoring P50/P95 at 1k/10k (100k with AGENTOS_BENCH_SCALING_FULL)',
    build: () => new ScalingProfile(),
  },
  {
    id: 'signal-ablation',
    family: 'micro',
    description: 'Prove each of the 6 retrieval signals is load-bearing (NDCG delta per ablation)',
    build: () => new SignalAblation(),
  },
  {
    id: 'longmemeval-s',
    family: 'external',
    description: 'LongMemEval-S (500 cases, ~115k-token haystacks)',
    build: ({ reader, readerByTier, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }) =>
      new LongMemEvalS({ reader, readerByTier, variant: 's', embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }),
  },
  {
    id: 'longmemeval-m',
    family: 'external',
    description: 'LongMemEval-M (~500 sessions per haystack) — medium-difficulty variant',
    build: ({ reader, readerByTier, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }) =>
      new LongMemEvalM({ reader, readerByTier, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }),
  },
  {
    id: 'longmemeval-oracle',
    family: 'external',
    description: 'LongMemEval-Oracle (evidence-only) — isolates reader quality from retrieval',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }) =>
      new LongMemEvalOracle({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }),
  },
  {
    id: 'locomo',
    family: 'external',
    description: 'LOCOMO (Maharana et al. 2024, 10 convos × ~300 turns, QA task only in v1)',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }) =>
      new Locomo({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled, observationalMemoryEnabled }),
  },
  {
    id: 'beam-100k',
    family: 'external',
    description:
      'BEAM 100K tier (Beyond a Million Tokens, ICLR 2026): 400 queries × 10 categories over 170 documents per user-haystack, 2.6M total tokens. Source: github.com/vectorize-io/agent-memory-benchmark.',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new Beam({ reader, tier: '100k', embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
  {
    id: 'beam-500k',
    family: 'external',
    description: 'BEAM 500K tier (download upstream first; 100K-tier-equivalent adapter wired)',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new Beam({ reader, tier: '500k', embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
  {
    id: 'beam-1m',
    family: 'external',
    description: 'BEAM 1M tier (download upstream first; queued for remote-machine execution due to memory budget)',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new Beam({ reader, tier: '1m', embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
  {
    id: 'beam-10m',
    family: 'external',
    description: 'BEAM 10M tier — frontier, Hindsight SOTA (download upstream first; remote-machine only)',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new Beam({ reader, tier: '10m', embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
];

function resolveDataDir(override?: string): string {
  return path.resolve(override ?? process.env.AGENTOS_BENCH_DATA_DIR ?? path.join(process.cwd(), 'data'));
}

function resolveResultsDir(override?: string): string {
  return path.resolve(
    override ?? process.env.AGENTOS_BENCH_RESULTS_DIR ?? path.join(process.cwd(), 'results'),
  );
}

function parseInteger(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Expected non-negative integer, got ${v}`);
  return n;
}

/**
 * Like {@link parseInteger} but rejects 0. Used for CLI flags that
 * cascade into `slice(0, N)` downstream where N=0 would degrade into
 * empty-pool behavior (e.g., `--reader-top-k 0` would zero out the
 * reader's retrieved-chunk window and fall through to a 1-chunk
 * fallback, producing bogus answers rather than crashing).
 */
function parsePositiveInteger(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Expected positive integer (>= 1), got ${v}`);
  }
  return n;
}

function parseFloatArg(v: string): number {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Expected non-negative number, got ${v}`);
  return n;
}

/**
 * Parse a closed-interval [0, 1] weight. Used by RRF blend weights where
 * `denseWeight = 1 - sparseWeight` must stay in [0, 1] to avoid producing
 * negative ranks at fusion time. Both endpoints are accepted (0 = pure
 * dense, 1 = pure sparse) but anything outside the unit interval errors.
 */
function parseUnitIntervalWeight(v: string): number {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`Expected weight in [0, 1], got ${v}`);
  }
  return n;
}

function parseRetrievalProfile(v: string): MemoryRetrievalProfile {
  if (v === 'fast' || v === 'balanced' || v === 'max-recall') return v;
  throw new Error(`Expected retrieval profile fast | balanced | max-recall, got ${v}`);
}

function parseAdaptiveMode(v: string): boolean {
  if (v === 'on') return true;
  if (v === 'off') return false;
  throw new Error(`Expected adaptive mode on | off, got ${v}`);
}

const VALID_ABLATE_SIGNALS = [
  'strength',
  'similarity',
  'recency',
  'emotionalCongruence',
  'graphActivation',
  'importance',
] as const;

function parseAblateSignal(v: string): (typeof VALID_ABLATE_SIGNALS)[number] {
  if ((VALID_ABLATE_SIGNALS as readonly string[]).includes(v)) {
    return v as (typeof VALID_ABLATE_SIGNALS)[number];
  }
  throw new Error(
    `Expected one of ${VALID_ABLATE_SIGNALS.join(' | ')}, got ${v}`,
  );
}

const VALID_ABLATE_MECHANISMS = [
  'reconsolidation',
  'retrievalInducedForgetting',
  'involuntaryRecall',
  'metacognitiveFOK',
  'temporalGist',
  'schemaEncoding',
  'sourceConfidenceDecay',
  'emotionRegulation',
] as const;

function parseAblateMechanism(v: string): (typeof VALID_ABLATE_MECHANISMS)[number] {
  if ((VALID_ABLATE_MECHANISMS as readonly string[]).includes(v)) {
    return v as (typeof VALID_ABLATE_MECHANISMS)[number];
  }
  throw new Error(
    `Expected one of ${VALID_ABLATE_MECHANISMS.join(' | ')}, got ${v}`,
  );
}

/**
 * Default case count for the cost preflight when `--sample` is not set.
 * Hardcoded so we don't have to load the dataset just to estimate cost.
 * Matches the published dataset sizes.
 */
function defaultCaseCountForBenchmark(id: string): number {
  switch (id) {
    case 'longmemeval-s':
    case 'longmemeval-m':
    case 'longmemeval-oracle':
      return 500;
    case 'locomo':
      // 10 conversations × ~200 QA pairs each in the upstream dump.
      return 2_000;
    case 'beam-100k':
      return 400;
    case 'beam-500k':
    case 'beam-1m':
    case 'beam-10m':
      return 400;
    default:
      return 100;
  }
}

/**
 * Pretty-print a completed run's headline numbers plus a per-type
 * accuracy breakdown when the benchmark produced one. Keeping this in
 * the CLI (not the BenchmarkRunner) so the underlying run result stays
 * a plain data object.
 */
function printRunSummary(result: import('./core/IBenchmark.js').BenchResult): void {
  const acc = (result.accuracy * 100).toFixed(1);
  const cpc = Number.isFinite(result.costPerCorrect)
    ? `$${result.costPerCorrect.toFixed(4)}`
    : '$∞';
  // eslint-disable-next-line no-console
  console.log(
    `Done. accuracy=${acc}% passed=${result.passedCases}/${result.totalCases} ` +
      `avg=${result.avgLatencyMs.toFixed(0)}ms p50=${result.p50LatencyMs.toFixed(0)}ms ` +
      `p95=${result.p95LatencyMs.toFixed(0)}ms totalUsd=$${result.totalUsd.toFixed(4)} ` +
      `costPerCorrect=${cpc}`,
  );

  const typeEntries = Object.entries(result.byType);
  if (typeEntries.length > 1) {
    // eslint-disable-next-line no-console
    console.log('By type:');
    const pad = Math.max(...typeEntries.map(([t]) => t.length));
    for (const [type, stats] of typeEntries.sort((a, b) => b[1].accuracy - a[1].accuracy)) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${type.padEnd(pad)}  n=${String(stats.n).padStart(3)}  acc=${(
          stats.accuracy * 100
        ).toFixed(1).padStart(5)}%  avgScore=${stats.avgScore.toFixed(3)}`,
      );
    }
  }
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name('agentos-bench')
    .description('Benchmark AgentOS memory against LongMemEval, LOCOMO, BEAM, and micro-benchmarks.')
    .version('0.1.0');

  program
    .command('list')
    .description('List built-in benchmarks with their families.')
    .action(() => {
      const pad = Math.max(...BENCHMARKS.map((b) => b.id.length));
      for (const b of BENCHMARKS) {
        // eslint-disable-next-line no-console
        console.log(`${b.id.padEnd(pad)}  [${b.family}]  ${b.description}`);
      }
    });

  program
    .command('run <benchmarkId>')
    .description('Run a benchmark and persist results.')
    .option('-r, --reader <model>', 'Reader model (e.g. claude-sonnet-4-6, gpt-4o)', 'claude-sonnet-4-6')
    .option('-m, --memory <mode>', "Memory mode: full-cognitive | base-memory | none", 'none')
    .option('-p, --replay <mode>', 'Replay mode: observe | ingest', 'ingest')
    .option('-n, --sample <n>', 'Run only the first N cases', parseInteger)
    .option('-c, --concurrency <n>', 'Parallel case execution', parseInteger, 3)
    .option('--profile <profile>', 'Retrieval profile: fast | balanced | max-recall', parseRetrievalProfile, 'balanced')
    .option('--adaptive <mode>', 'Adaptive retrieval: on | off', parseAdaptiveMode, true)
    .option('--max-usd <amount>', 'Abort if projected USD exceeds this cap', parseFloatArg)
    .option('--data-dir <path>', 'Dataset cache directory')
    .option('--results-dir <path>', 'Results directory')
    .option('--judge-model <model>', 'Judge LLM (external benchmarks only)', 'gpt-4o')
    .option(
      '--embedder-model <model>',
      'Embedder model for the full-cognitive path (e.g. openai:text-embedding-3-small). Falls back to the CharHash stub when omitted.',
    )
    .option(
      '--reader-router <preset>',
      "Per-category reader-tier router: dispatch the answer reader per case based on the gpt-5-mini classifier's predicted category. Only 'min-cost-best-cat-2026-04-28' is calibrated today (gpt-4o for TR/SSU, gpt-5-mini for SSP/SSA/KU/MS — oracle 87.0% on S Phase B vs 83.2% at either reader alone). When unset the bench uses the single --reader for every case.",
      (value: string) => {
        if (value !== 'min-cost-best-cat-2026-04-28') {
          throw new Error(
            `--reader-router must be 'min-cost-best-cat-2026-04-28', got '${value}'`,
          );
        }
        return value;
      },
    )
    .option('--retrieval-k <n>', 'K for retrieval-quality metrics (Recall/Precision/NDCG@K)', parseInteger, 10)
    .option('--stratified', 'Enable stratified sampling + weighted accuracy aggregation')
    .option('--sample-per-type <n>', 'Cases per case-type (implies --stratified)', parseInteger)
    .option('--track-footprint', 'Capture brain bytes + trace counts (default: on)', true)
    .option('--no-footprint', 'Disable footprint tracking for maximum-throughput runs')
    .option(
      '--ablate-signal <signal>',
      'Zero one retrieval signal: strength | similarity | recency | emotionalCongruence | graphActivation | importance',
      parseAblateSignal,
    )
    .option(
      '--ablate-mechanism <mechanism>',
      'Disable one cognitive mechanism: reconsolidation | retrievalInducedForgetting | involuntaryRecall | metacognitiveFOK | temporalGist | schemaEncoding | sourceConfidenceDecay | emotionRegulation',
      parseAblateMechanism,
    )
    .option(
      '--rerank <provider>',
      'Enable neural reranker. Only "cohere" is wired today. Needs COHERE_API_KEY (or --rerank-api-key).',
    )
    .option(
      '--rerank-model <id>',
      'Cohere rerank model id (e.g. rerank-v3.5, rerank-v4.0-pro, rerank-v4.0-fast). Default: rerank-v3.5.',
    )
    .option(
      '--rerank-api-key <key>',
      'Cohere API key override. Falls back to COHERE_API_KEY env.',
    )
    .option(
      '--rerank-candidate-multiplier <n>',
      'Retrieve topK × N candidates before the reranker re-sorts; reader still sees topK after rerank. Default: 3 when rerank is on.',
      parseInteger,
    )
    .option(
      '--reader-top-k <n>',
      'How many retrieved chunks the reader sees after rerank and score-floor filtering (must be >= 1; adapter default is 10). Candidate pool for rerank scales as K × rerank.candidateMultiplier, so K=15 at the default 3× multiplier re-ranks a 45-chunk pool. Use to investigate multi-session coverage trade-offs.',
      parsePositiveInteger,
    )
    .option(
      '--context-summary <model>',
      'Enable session-level contextual retrieval (Anthropic Sep 2024). An LLM generates a dense per-session summary that is prepended to every chunk before embedding. Value is the model id used to generate summaries (e.g. "gpt-5-mini", "claude-haiku-4-5"). Cached on disk under <dataDir>/.session-summary-cache/.',
    )
    .option(
      '--judge-adversarial',
      'Enable judge-adversarial probe: synthesize topically-adjacent wrong answers, score with the same judge, report judge false-positive rate (noise floor). Adds one cheap synth call + one judge call per probed case. Cost bounded by --judge-adversarial-max-probes.',
    )
    .option(
      '--judge-adversarial-max-probes <n>',
      'Max cases probed when --judge-adversarial is set. Default: 50.',
      parsePositiveInteger,
      50,
    )
    .option(
      '--judge-adversarial-synth-model <model>',
      'Cheap LLM for synthesizing adversarial distractors. Default: gpt-5-mini.',
      'gpt-5-mini',
    )
    .option(
      '--bootstrap-resamples <n>',
      'Bootstrap resamples for accuracy confidence intervals. Default: 10000.',
      parsePositiveInteger,
      10_000,
    )
    .option(
      '--session-retrieval',
      'Enable Step-2 session-level hierarchical retrieval (xMemory / TACITREE pattern). Stage 1 selects top-K sessions by summary similarity; Stage 2 takes top-M chunks per session. Requires --context-summary to be set so session summaries exist.',
    )
    .option(
      '--session-retrieval-top-sessions <n>',
      'K for Stage 1: number of sessions selected by summary similarity. Default: 5.',
      parsePositiveInteger,
      5,
    )
    .option(
      '--session-retrieval-chunks-per-session <n>',
      'M for Stage 2: chunks kept per session after post-filter. Default: 3.',
      parsePositiveInteger,
      3,
    )
    .option(
      '--hybrid-retrieval',
      'Enable Step-3 hybrid BM25 + dense RRF retrieval. Mutually exclusive with --session-retrieval in Step 3 MVP. Preserves cognitive scoring on the dense side; reranker (if --rerank set) runs over the merged pool.',
    )
    .option(
      '--hyde',
      'Enable Step-4 HyDE (Hypothetical Document Embedding) retrieval. Cheap LLM generates a hypothetical answer used as the search query; improves recall on vague/abstract queries. Orthogonal to --session-retrieval and --hybrid-retrieval. When combined with --hybrid-retrieval, the hypothesis is used for BOTH dense and sparse; rerank keeps the ORIGINAL user query.',
    )
    .option(
      '--fact-supersession',
      'Enable Step-5 FactSupersession post-retrieval filter. One gpt-5-mini LLM call per query identifies superseded traces (contradictory claims about the same subject) and drops them before the reader sees them. Targets the knowledge-update ceiling. Orthogonal to other retrieval flags.',
    )
    .option(
      '--split-ambiguous <n>',
      'Enable Step-6 split-on-ambiguous rerank refinement. Bottom fraction (0-1) of traces by first-pass rerank score get split at sentence boundaries and rescored; replaced only if the better half outscores the original. Monotonic. Typical: 0.3. Requires --hybrid-retrieval.',
      parseFloatArg,
    )
    .option(
      '--observer-reflector',
      'Enable Step-7 Observer/Reflector pipeline (Tier 2 progressive enhancement). Adds personality-biased observation-note extraction at 30k-token intervals, compression at 50-note intervals, and reflector-driven trace consolidation + supersession. Matches Mastra "Observational Memory" pattern. Uses gpt-5-mini as the observer/reflector invoker by default.',
    )
    .option(
      '--observer-reflector-replace',
      'Enable Step-8 REPLACEMENT semantics for Observer/Reflector (Tier 2 fix). Skips raw chunk encoding during ingest, forces reflection at session boundaries via manager.flushReflection(), indexes reflection-derived trace IDs into hybrid BM25. Requires --observer-reflector. Addresses Step 7 RED (additive overlay dilutes retrieval).',
    )
    .option(
      '--fact-graph-ingest',
      'Enable Step-9 Mem0-style fact-graph ingest (Tier 3). Per-session gpt-5-mini extractor emits closed-schema (subject, predicate, object, timestamp) tuples; synthetic fact-graph traces with retrievalScore:1.0 are prepended to the HybridRetriever merged pool BEFORE rerank. Preserves literal object tokens where Steps 5/7/8 paraphrased them away. Mutually exclusive with --observer-reflector / --observer-reflector-replace.',
    )
    .option(
      '--graph-activation',
      'Enable Step-13 graph activation wire-up. Heuristic regex entity extraction (zero LLM) at ingest populates trace.entities and creates co-occurrence edges in SqlKnowledgeGraph. At retrieve, Anderson spreading activation seeded from query entities computes the sixth composite-score signal (weight 0.10 in RetrievalPriorityScorer, previously hardcoded to 0). Additive, deterministic, dodges the n=8 LLM-mediated-content RED pattern by construction.',
    )
    .option(
      '--two-call-reader',
      'Enable Step-14 Emergence-style two-call reader. First call extracts a JSON fact scratchpad from top-K retrieved passages with passage-id citations; second call answers from the scratchpad only (no raw passages in final context). Both calls use --reader. Targets reader-conversion headroom (~83% at single-call baseline) to close the gap toward competitor systems that publish 80%+. Default: off.',
    )
    .option(
      '--observational-memory',
      'Enable Step-15 Mastra-style Observational Memory. DISABLES the retrieval pipeline (no HybridRetriever, no rerank, no top-K). Observer LLM extracts dated priority-tagged observations over token-bounded batches of sessions (Step 15 v2 default: 24k-token batches); Reflector consolidates when the log exceeds 40k tokens. Reader sees the full observation log + question in a single call. Verbatim port of Mastra OM prompts (Apache-2.0). Observer model: gpt-5-mini (substituted for Mastra\u2019s gemini-2.5-flash because the bench ships with OpenAI keys only). Default: off.',
    )
    .option(
      '--om-batch-tokens <n>',
      'Step 15 v2: token target per Observer batch in OM ingest (default 24000). Sessions are grouped in haystack order until cumulative tokens exceed this target; a single session exceeding the target becomes its own batch (no mid-session split). Matches Mastra\u2019s messageTokens \u00D7 bufferActivation = 30000 \u00D7 0.8 = 24000 default. Only effective with --observational-memory. Lower values (e.g. 12000) produce more, smaller batches; higher values (e.g. 40000) produce fewer, larger batches up to the observer\u2019s input budget.',
      parsePositiveInteger,
    )
    .option(
      '--om-mode <mode>',
      'Step 15 observer ingest mode. Values: per-session (v1, one Observer call per session, preserves per-session fidelity), batched (v2, one call per 24k-token batch, encodes cross-session patterns but compresses per-session detail), dual-path (v3 default, both passes concatenated), hierarchical (v4b, per-session Observer + one synthesis call over the per-session log using --om-synthesis-model — compact synthesis block appended to the per-session log). Only effective with --observational-memory.',
      (value: string) => {
        if (
          value !== 'per-session' &&
          value !== 'batched' &&
          value !== 'dual-path' &&
          value !== 'hierarchical'
        ) {
          throw new Error(
            `--om-mode must be 'per-session' | 'batched' | 'dual-path' | 'hierarchical', got "${value}"`,
          );
        }
        return value;
      },
    )
    .option(
      '--om-synthesis-model <model>',
      'Step 15 v4b: model identifier for the hierarchical-mode synthesis call over the per-session observation log. Typically a stronger reasoning model (e.g. gpt-4o) than the observer model. Only consulted when --om-mode is hierarchical. Default: same as the observer model (gpt-5-mini).',
    )
    .option(
      '--om-observer-model <model>',
      'Step 15 v5: model identifier for the Observer and Reflector LLM calls in OM ingest. Default gpt-5-mini. Upgrading to gpt-4o tests whether observer-model tier closes the ~10pp gap to Mastra\u2019s published 84.23% gpt-4o result (which uses gemini-2.5-flash as their observer). Only effective with --observational-memory.',
    )
    .option(
      '--om-with-retrieval',
      'Step 16: combine OM observation log with HybridRetriever top-K passages (BM25 + dense + RRF + Cohere rerank) in a single reader context. The reader sees both the dense cross-session synthesis (from OM) AND the per-chunk verbatim specifics (from retrieval), addressing multi-session gaps that neither layer solves alone. Runs both ingest pipelines. Only effective with --observational-memory.',
    )
    .option(
      '--om-dynamic-router',
      'Step 16c v2: classify each question via gpt-5-mini, then route to either canonical Step 3 HybridRetriever (no OM) or v5 OM (gpt-4o observer + scaffold + dual-path) based on the per-category Phase A best (SSU/SSA/SSP/TR \u2192 canonical; KU/MS \u2192 v5 OM). Overrides --om-reader-scaffold and --om-with-retrieval per-case based on classification. Only effective with --observational-memory.',
    )
    .option(
      '--om-classifier-model <model>',
      'Step 16c v2: model identifier for the dynamic router\'s classification call. Default `gpt-5-mini` (cheap, fast). Set to `gpt-4o` when classifier accuracy at gpt-5-mini is too low (initial Tier A measured 37.5%). Only effective with --om-dynamic-router.',
    )
    .option(
      '--om-classifier-fewshot',
      'Step 16c v10: use the few-shot variant of the classifier prompt. Adds explicit Question/Category pairs after category definitions to disambiguate SSU-vs-SSA, SSP-vs-SSA, MS-vs-KU confusion patterns. Only effective with --om-dynamic-router.',
    )
    .option(
      '--om-guided-retrieval',
      'Step 17: scope HybridRetriever to OM-identified candidate sessions. The OM observation log is used to score each session by query-relevance, then post-hoc filter retrieved evidence to top-K candidates. Reader sees OM log + scoped passages. Architectural alternative to Step 16c routing. Only effective with --observational-memory.',
    )
    .option(
      '--om-guided-retrieval-k <n>',
      'Step 17: number of candidate sessions to keep when --om-guided-retrieval is on. Default 5. Smaller K narrows scope (less pollution) but risks missing the gold session.',
      parsePositiveInteger,
    )
    .option(
      '--om-retriever-ms-k <n>',
      'Step 19A: per-case readerTopK override for MS-classified cases (v10 router only). Default 10. Set to 30 for K=30 retrieval on multi-session questions; preserves baseline K for all other categories.',
      parsePositiveInteger,
    )
    .option(
      '--om-retriever-ms-bm25-weight <w>',
      'Step 19B: per-case BM25 sparse weight in RRF for MS-classified cases (v10 router only). Must be in [0, 1] (denseWeight = 1 - sparseWeight). Default RRF dense=0.7/sparse=0.3. Set to 0.7 for BM25-heavy fusion (dense=0.3/sparse=0.7) on multi-session questions only; preserves baseline weights for all other categories.',
      parseUnitIntervalWeight,
    )
    .option(
      '--om-retriever-ms-overfetch <m>',
      'Step 19C: per-case over-fetch multiplier (positive integer) for MS-classified cases (v10 router only). Default 3 (over-fetch K = recallTopK * 3). Set to 6 for K=60 over-fetch on multi-session questions only; preserves baseline over-fetch for all other categories.',
      parsePositiveInteger,
    )
    .option(
      '--no-capture-retention-inputs',
      'Step 18: opt OUT of capturing the post-Observer compressed observation log (omFinalLog) into per-case metadata. Default ON (the token-retention metric needs the log to compute per-stage rates). Disable when running benchmarks that do NOT consume the retention metric (saves ~10-20MB per cached run JSON at N=500).',
    )
    .option(
      '--om-reader-scaffold',
      'Step 15 v4a: append a cross-session reasoning scaffold to the OM reader system prompt. The scaffold walks the reader through multi-step synthesis (scan all date-grouped sections, extract per-session facts, order chronologically, synthesize). Targets the v3 failure mode where the reader fixates on the most-recent-date observation block and misses cross-session synthesis. Only effective with --observational-memory. Default off.',
    )
    .option(
      '--policy-router',
      'Tier 3 policy router: dispatch per-query to tier_1_canonical / tier_2a_v10 / tier_2b_v11 based on the v10 classifier prediction + routing table. Mutually exclusive with --om-dynamic-router. See --policy-router-preset for preset selection; see --policy-router-budget-per-query for optional budget envelope.',
    )
    .option(
      '--policy-router-preset <preset>',
      'Tier 3 routing preset: maximize-accuracy (default, realistic 75.3% at $0.357/correct = 1.22x cheaper vs Tier 2b flat), balanced (74.5% at $0.205/correct = 2.12x cheaper), minimize-cost (73.9% at $0.092/correct = 4.77x cheaper). Only effective with --policy-router.',
      (value: string) => {
        if (
          value !== 'maximize-accuracy' &&
          value !== 'balanced' &&
          value !== 'minimize-cost'
        ) {
          throw new Error(
            `--policy-router-preset must be 'maximize-accuracy' | 'balanced' | 'minimize-cost', got '${value}'`,
          );
        }
        return value;
      },
    )
    .option(
      '--policy-router-budget-per-query <USD>',
      'Tier 3 per-query USD ceiling. Unbounded when omitted. Combined with --policy-router-budget-mode to control exceed behavior. Only effective with --policy-router.',
      parseFloatArg,
    )
    .option(
      '--policy-router-budget-mode <mode>',
      'Tier 3 budget mode: hard (default, throws on exceed) | soft (exceed only when better $/correct) | cheapest-fallback (downgrade to cheapest-that-fits). Only effective with --policy-router AND --policy-router-budget-per-query set.',
      (value: string) => {
        if (value !== 'hard' && value !== 'soft' && value !== 'cheapest-fallback') {
          throw new Error(
            `--policy-router-budget-mode must be 'hard' | 'soft' | 'cheapest-fallback', got '${value}'`,
          );
        }
        return value;
      },
    )
    .option(
      '--retrieval-config-router <preset>',
      "RetrievalConfigRouter (2026-04-26 v2): per-case retrieval-config dispatch on canonical-hybrid. Classifies each query via gpt-5-mini, looks up the calibrated MINIMIZE_COST_AUGMENTED_TABLE, and overrides the run-level --hyde / --reader-top-k / --rerank-candidate-multiplier flags for that case. Calibration: 2026-04-26 LongMemEval-M Phase A N=54 ablation matrix; forecast aggregate 68.5% (vs static M-tuned 57.4%, canonical baseline 30.6%). Orthogonal to --policy-router (which dispatches the backend axis). Only preset: minimize-cost-augmented. Cache fingerprint: stage-rcr:<preset>:v1.",
      (value: string) => {
        if (value !== 'minimize-cost-augmented') {
          throw new Error(
            `--retrieval-config-router must be 'minimize-cost-augmented' (only preset shipped in v2), got '${value}'`,
          );
        }
        return value;
      },
    )
    .option(
      '--session-level-ndcg',
      'Stage C / Tier 4a: session-level NDCG retrieval post-process. After canonical HybridRetriever returns top-K traces, group them by sessionId, compute NDCG per session, pick top-K sessions (see --session-level-ndcg-top-k), and expand evidence to ALL turns of those sessions from the haystack. Matches Emergence AI Simple recipe. Applies to canonical path only; ignored on OM branches.',
    )
    .option(
      '--session-level-ndcg-top-k <n>',
      'Stage C: number of top-NDCG sessions to expand. Default 3. Only effective with --session-level-ndcg.',
      parsePositiveInteger,
    )
    .option(
      '--no-abstention',
      "Stage F-2: suppress abstention instructions in the reader system prompt. Tells the reader every question has an answer in the retrieved excerpts and it must commit to a best-effort answer instead of responding 'I don\\'t know'. Intended for OOD benchmarks whose non-adversarial categories guarantee answerability (LOCOMO single-hop / multi-hop / temporal / open-domain). Cache fingerprint: stage-f2-no-abstention:v1.",
    )
    .option(
      '--entity-linking [weight]',
      'Stage I: post-retrieval re-rank by Mem0-v3-style entity-overlap. Weight in [0,1] sets the entity signal blend in combinedScore = (1-w)*semanticScore + w*entityOverlapRatio. Default when flag is supplied without a value: 0.5. Cache fingerprint: stage-i-entity-linking:w<weight>:v1.',
      (val: string | true) => (val === true ? 0.5 : Number(val)),
    )
    .option(
      '--typed-network <variant>',
      'Stage E: Hindsight 4-network typed observer (arxiv:2512.12818). Variants: minimal (4-bank routing only), full (4-bank + spreading + 4-way RRF), production (full + LLM-driven causal extraction). Wires the typed-network module from @framers/agentos/memory/retrieval/typed-network into the retrieval path. Cache fingerprint: stage-e-typed-network:<variant>:v1.',
      (value: string) => {
        if (value !== 'minimal' && value !== 'full' && value !== 'production') {
          throw new Error(
            `--typed-network must be 'minimal' | 'full' | 'production', got "${value}"`,
          );
        }
        return value;
      },
    )
    .option(
      '--seed <n>',
      'Deterministic seed for bootstrap resampling (and any future RNG-dependent pipeline). Use for reproducible findings-doc CIs.',
      parseInteger,
    )
    .option('--dry-run', 'Use MockReader / mock judge (no API calls)')
    .action(async (benchmarkId: string, opts) => {
      const entry = BENCHMARKS.find((b) => b.id === benchmarkId);
      if (!entry) {
        // eslint-disable-next-line no-console
        console.error(`Unknown benchmark '${benchmarkId}'. Run 'agentos-bench list' to see options.`);
        process.exitCode = 1;
        return;
      }

      // --sample-per-type implies --stratified. If both --sample and
      // --sample-per-type are supplied, --sample-per-type takes effect
      // per the adapter logic (which respects samplePerType when set).
      const stratified = Boolean(opts.stratified || typeof opts.samplePerType === 'number');
      if (typeof opts.sample === 'number' && typeof opts.samplePerType === 'number') {
        // eslint-disable-next-line no-console
        console.warn(
          '[cli] both --sample and --sample-per-type supplied; --sample-per-type takes effect for stratified adapters.',
        );
      }

      // Resolve rerank config from CLI flags. Only "cohere" is wired
      // today; any other provider string aborts the run with a clear
      // error so typos don't silently disable reranking.
      let rerank: RunConfig['rerank'];
      if (opts.rerank) {
        const provider = String(opts.rerank).toLowerCase();
        if (provider !== 'cohere') {
          // eslint-disable-next-line no-console
          console.error(
            `Unknown rerank provider '${opts.rerank}'. Only 'cohere' is currently supported.`,
          );
          process.exitCode = 1;
          return;
        }
        rerank = {
          provider: 'cohere',
          model: (opts.rerankModel as string | undefined),
          apiKey:
            (opts.rerankApiKey as string | undefined) ??
            process.env.COHERE_API_KEY,
          candidateMultiplier:
            (opts.rerankCandidateMultiplier as number | undefined),
        };
        if (!rerank.apiKey) {
          // eslint-disable-next-line no-console
          console.warn(
            '[cli] --rerank cohere supplied but no Cohere API key resolved. ' +
              'Set COHERE_API_KEY or pass --rerank-api-key. Bench will fall back to cognitive-only scoring.',
          );
        }
      }

      const runConfig: RunConfig = {
        reader: opts.reader as ReaderModel,
        memoryMode: opts.memory as MemoryMode,
        replayMode: opts.replay as ReplayMode,
        sampleN: opts.sample,
        concurrency: opts.concurrency,
        maxUsd: opts.maxUsd,
        retrievalProfile: opts.profile as MemoryRetrievalProfile,
        adaptiveRetrieval: opts.adaptive as boolean,
        retrievalK: opts.retrievalK as number | undefined,
        stratified,
        samplePerType: opts.samplePerType as number | undefined,
        // commander's --track-footprint / --no-footprint flip the same
        // option; default is true (capture enabled).
        trackFootprint: opts.footprint as boolean,
        ablateSignal: opts.ablateSignal as RunConfig['ablateSignal'],
        ablateMechanism: opts.ablateMechanism as RunConfig['ablateMechanism'],
        rerank,
        // Fingerprint for the case-run cache key. The summarizer
        // INSTANCE is constructed below and passed via entry.build();
        // this field is the model id used for cache invalidation.
        contextSummaryModel: opts.contextSummary as string | undefined,
        // Reader's retrieved-chunk window. Undefined inherits the
        // adapter default (currently 10). See spec
        // 2026-04-19-reader-topk-bump-design.md for resolution
        // priority (ctx.config.readerTopK > this.opts.recallTopK > 10).
        readerTopK: opts.readerTopK as number | undefined,
        // Step-1 infra: flag-gated judge-adversarial probe + CI knobs.
        // Defaults match the umbrella spec: probe off, max 50 probes,
        // gpt-5-mini synth, 10k bootstrap resamples.
        judgeAdversarial: Boolean(opts.judgeAdversarial),
        judgeAdversarialMaxProbes: opts.judgeAdversarialMaxProbes as
          | number
          | undefined,
        judgeAdversarialSynthModel: opts.judgeAdversarialSynthModel as
          | string
          | undefined,
        bootstrapResamples: opts.bootstrapResamples as number | undefined,
        seed: opts.seed as number | undefined,
        sessionRetrieval: Boolean(opts.sessionRetrieval),
        sessionRetrievalTopSessions: opts.sessionRetrievalTopSessions as number | undefined,
        sessionRetrievalChunksPerSession: opts.sessionRetrievalChunksPerSession as number | undefined,
        hybridRetrieval: Boolean(opts.hybridRetrieval),
        hyde: Boolean(opts.hyde),
        factSupersession: Boolean(opts.factSupersession),
        splitAmbiguous: opts.splitAmbiguous as number | undefined,
        observerReflector: Boolean(opts.observerReflector),
        observerReflectorReplace: Boolean(opts.observerReflectorReplace),
        factGraphIngest: Boolean(opts.factGraphIngest),
        graphActivation: Boolean(opts.graphActivation),
        twoCallReader: Boolean(opts.twoCallReader),
        observationalMemory: Boolean(opts.observationalMemory),
        omBatchTokenTarget: opts.omBatchTokens,
        omMode: opts.omMode,
        omReaderScaffold: Boolean(opts.omReaderScaffold),
        omSynthesisModel: opts.omSynthesisModel,
        omObserverModel: opts.omObserverModel,
        omWithRetrieval: Boolean(opts.omWithRetrieval),
        omDynamicRouter: Boolean(opts.omDynamicRouter),
        omClassifierModel: opts.omClassifierModel,
        omClassifierFewshot: Boolean(opts.omClassifierFewshot),
        omGuidedRetrieval: Boolean(opts.omGuidedRetrieval),
        omGuidedRetrievalK: opts.omGuidedRetrievalK,
        omRetrieverMsKOverride: opts.omRetrieverMsK,
        omRetrieverMsBm25Weight: opts.omRetrieverMsBm25Weight,
        omRetrieverMsOverFetchMultiplier: opts.omRetrieverMsOverfetch,
        // Commander.js negation: --no-capture-retention-inputs sets
        // opts.captureRetentionInputs === false, default is true.
        captureRetentionInputs: opts.captureRetentionInputs as boolean | undefined,
        policyRouter: Boolean(opts.policyRouter) || undefined,
        policyRouterPreset: opts.policyRouterPreset as
          | 'maximize-accuracy'
          | 'balanced'
          | 'minimize-cost'
          | undefined,
        policyRouterBudgetPerQuery: opts.policyRouterBudgetPerQuery as number | undefined,
        policyRouterBudgetMode: opts.policyRouterBudgetMode as
          | 'hard'
          | 'soft'
          | 'cheapest-fallback'
          | undefined,
        retrievalConfigRouter: opts.retrievalConfigRouter as
          | 'minimize-cost-augmented'
          | undefined,
        // Loadbearing: drives the case-run + case-result cache
        // fingerprint so CharHash and semantic-embedder runs don't
        // share cached answers (which they should NOT — semantic
        // embeddings produce materially different retrieval orderings).
        embedderModel: opts.embedderModel as string | undefined,
        // Loadbearing: drives the case-run + case-result cache fingerprint
        // so reader-router runs don't share cached answers with single-
        // reader runs at the same --reader value (different reader
        // dispatched per case = different actualOutput per case).
        readerRouter: opts.readerRouter as string | undefined,
        sessionLevelNdcg: Boolean(opts.sessionLevelNdcg) || undefined,
        sessionLevelNdcgTopK: opts.sessionLevelNdcgTopK as number | undefined,
        // Stage F-2: commander's --no-abstention sets opts.abstention === false
        // via the --no-<flag> negation pattern. Treat `abstention === false`
        // as explicit opt-in to the no-abstention prompt; leave undefined
        // otherwise so the cache fingerprint stays off.
        noAbstention: opts.abstention === false ? true : undefined,
        // Stage I: --entity-linking [weight] enables Mem0-v3-style
        // post-retrieval re-rank. Coerced to number by the option parser
        // above; undefined when flag is absent so cache fingerprint stays off.
        entityLinking:
          typeof opts.entityLinking === 'number' && opts.entityLinking > 0
            ? opts.entityLinking
            : undefined,
        // Stage E: --typed-network <variant> enables the Hindsight 4-network
        // typed observer at retrieval time. Variant validated by the option
        // parser above; undefined when flag is absent so cache fingerprint
        // stays off and existing cached results are reusable.
        typedNetwork: opts.typedNetwork as
          | 'minimal'
          | 'full'
          | 'production'
          | undefined,
      };

      // Tier 3 policy router validation: mutually exclusive with the v10
      // dynamic router (both would dispatch; policy router is v10's strict
      // superset). Budget-mode without budget-per-query is a silent no-op
      // otherwise — reject explicitly so users see the bug at CLI time.
      if (runConfig.policyRouter && runConfig.omDynamicRouter) {
        // eslint-disable-next-line no-console
        console.error(
          '[cli] --policy-router and --om-dynamic-router are mutually exclusive. ' +
            'Choose one dispatch strategy.',
        );
        process.exitCode = 2;
        return;
      }
      if (runConfig.policyRouterBudgetMode && !runConfig.policyRouter) {
        // eslint-disable-next-line no-console
        console.error(
          '[cli] --policy-router-budget-mode requires --policy-router. Aborting.',
        );
        process.exitCode = 2;
        return;
      }
      if (
        typeof runConfig.policyRouterBudgetPerQuery === 'number' &&
        !runConfig.policyRouter
      ) {
        // eslint-disable-next-line no-console
        console.error(
          '[cli] --policy-router-budget-per-query requires --policy-router. Aborting.',
        );
        process.exitCode = 2;
        return;
      }

      // Cost preflight — coarse but enough to catch "oh no I just
      // fired 500 × Opus 4.7 cases by mistake" before any LLM call
      // goes out. Runs before createReader / judge construction so
      // aborting is cheap even when API keys are missing.
      if (entry.family === 'external' && !opts.dryRun) {
        // Rough haystack-size estimate needs a case count. We skip the
        // real dataset load to stay fast — the estimator's per-benchmark
        // haystack table gives a usable number with caseCount=sampleN
        // or a generous default.
        const caseCount = opts.sample ?? defaultCaseCountForBenchmark(entry.id);
        const estimate = estimateRunCost({
          benchmarkId: entry.id,
          family: 'external',
          caseCount,
          sampleN: opts.sample,
          reader: opts.reader as ReaderModel,
          judgeModel: opts.judgeModel as ReaderModel,
          memoryMode: opts.memory as MemoryMode,
        });
        // eslint-disable-next-line no-console
        console.log(
          `Preflight cost estimate: ~$${estimate.totalUsd.toFixed(2)} for ${estimate.effectiveCaseCount} cases ` +
            `($${estimate.readerUsdPerCase.toFixed(4)}/case reader, $${estimate.judgeUsdPerCase.toFixed(4)}/case judge).`,
        );
        for (const w of estimate.warnings) console.log(`  warn: ${w}`);
        if (typeof opts.maxUsd === 'number' && estimate.totalUsd > opts.maxUsd) {
          // eslint-disable-next-line no-console
          console.error(
            `Aborting: projected $${estimate.totalUsd.toFixed(2)} exceeds --max-usd $${opts.maxUsd.toFixed(2)}. ` +
              `Pass a higher --max-usd or use --sample N to bound the run.`,
          );
          process.exitCode = 1;
          return;
        }
      }

      const judge = opts.dryRun
        ? new LongMemEvalJudge({
            reader: new MockReader(opts.judgeModel).on(
              () => true,
              () => ({
                text: 'yes',
                tokensIn: 0,
                tokensOut: 1,
                model: opts.judgeModel,
                latencyMs: 0,
              }),
            ),
          })
        : entry.family === 'external'
          ? new LongMemEvalJudge({ reader: createReader(opts.judgeModel as ReaderModel) })
          : ({
              model: 'noop',
              rubricVersion: '0',
              async judge() {
                throw new Error('judge invoked on a micro-benchmark');
              },
            } as const);

      // Reader construction: real HTTP client for production runs,
      // scripted MockReader for --dry-run so offline smoke tests do not
      // require API keys. Micro-benchmarks ignore the reader (they do
      // synthetic assertions), so the mock default is harmless.
      const reader = opts.dryRun
        ? new MockReader(opts.reader as string).on(
            () => true,
            () => ({
              text: '[dry-run mock answer]',
              tokensIn: 0,
              tokensOut: 1,
              model: opts.reader as string,
              latencyMs: 0,
            }),
          )
        : entry.family === 'micro'
          ? new MockReader(opts.reader as string)
          : createReader(opts.reader as ReaderModel);

      // Reader-router auxiliary pool. When `--reader-router <preset>` is set,
      // build BOTH gpt-4o and gpt-5-mini reader instances up front and pass
      // them via `readerByTier` to the bench so per-case dispatch has both
      // tiers available. The default `--reader` instance above stays the
      // fallback for cases where the dispatched tier isn't in the pool or
      // the classifier errors. Skip in --dry-run + micro-benchmark mode for
      // the same reasons single-reader runs use MockReader there.
      let readerByTier:
        | Partial<Record<'gpt-4o' | 'gpt-5-mini', IReader>>
        | undefined;
      if (
        opts.readerRouter &&
        !opts.dryRun &&
        entry.family !== 'micro'
      ) {
        readerByTier = {
          'gpt-4o':
            (opts.reader as ReaderModel) === 'gpt-4o'
              ? reader
              : createReader('gpt-4o'),
          'gpt-5-mini':
            (opts.reader as ReaderModel) === 'gpt-5-mini'
              ? reader
              : createReader('gpt-5-mini'),
        };
      }

      // Optional real embedder for the full-cognitive path. When the
      // flag is absent the adapter falls back to CharHashEmbedder,
      // which is fine for smoke tests but not for publishable numbers.
      // A persistent on-disk embedding cache wraps the real embedder
      // so re-runs reuse previously-embedded chunks at zero cost.
      let embedder: IEmbeddingManager | undefined;
      if (opts.embedderModel && !opts.dryRun) {
        const inner = createOpenAIEmbedderFromEnv(opts.embedderModel as string);
        embedder = new CachedEmbedder(inner, {
          cacheDir: path.join(
            resolveDataDir(opts.dataDir),
            '.embedding-cache',
          ),
          modelId: opts.embedderModel as string,
        });
      }

      // Optional session-level contextual-retrieval summarizer
      // (Anthropic Sep 2024 variant, agentos core). When enabled, one
      // LLM call per session produces a dense summary that is
      // prepended to every chunk before embedding. Disk-cached so
      // re-runs cost ~0. The summarizer reader is an independent
      // gpt-5-mini / claude HTTP client so summarization cost doesn't
      // inflate the main reader's token budget tracking.
      let sessionSummarizer: SessionSummarizer | undefined;
      if (opts.contextSummary && !opts.dryRun && !runConfig.memoryMode.startsWith('none')) {
        const summarizerModel = opts.contextSummary as ReaderModel;
        const summarizerReader = createReader(summarizerModel);
        sessionSummarizer = new SessionSummarizer({
          invoker: async (system, user) => {
            const resp = await summarizerReader.invoke({
              system,
              user,
              maxTokens: 140,
              temperature: 0,
            });
            return {
              text: resp.text,
              tokensIn: resp.tokensIn,
              tokensOut: resp.tokensOut,
              model: resp.model,
            };
          },
          cacheDir: path.join(
            resolveDataDir(opts.dataDir),
            '.session-summary-cache',
          ),
          modelId: summarizerModel,
        });
      }

      // Step 2: construct a SessionSummaryStore when --session-retrieval
      // is set. The SessionRetriever itself is built per-case inside
      // runFullCognitiveCase because it needs the per-case MemoryStore
      // (owned by createCognitiveManager's internal brain). A dedicated
      // InMemoryVectorStore decouples the summary index lifetime from
      // the per-case trace store. The embedder is shared so cached
      // query embeddings apply.
      let sessionSummaryStore: import('@framers/agentos/memory').SessionSummaryStore | undefined;
      if (runConfig.sessionRetrieval && embedder && !opts.dryRun) {
        if (!sessionSummarizer) {
          throw new Error(
            '--session-retrieval requires --context-summary to be set so session summaries exist.',
          );
        }
        const { InMemoryVectorStore } = await import(
          '@framers/agentos/rag/vector_stores/InMemoryVectorStore'
        );
        const summaryVectorStore = new InMemoryVectorStore();
        await summaryVectorStore.initialize({
          id: 'bench-session-summaries',
          type: 'in_memory',
          defaultEmbeddingDimension: embedder.getEmbeddingDimension(),
          similarityMetric: 'cosine',
        } as import('@framers/agentos/core/vector-store/IVectorStore').VectorStoreProviderConfig);
        const { SessionSummaryStore } = await import('@framers/agentos/memory');
        sessionSummaryStore = new SessionSummaryStore({
          vectorStore: summaryVectorStore,
          embeddingManager: embedder,
        });
      }

      const runner = new BenchmarkRunner({
        dataDir: resolveDataDir(opts.dataDir),
        resultsDir: resolveResultsDir(opts.resultsDir),
        judge,
      });

      // eslint-disable-next-line no-console
      console.log(
        `Running ${entry.id} reader=${runConfig.reader} memory=${runConfig.memoryMode} replay=${runConfig.replayMode}${opts.dryRun ? ' (dry-run)' : ''}${runConfig.sampleN ? ` sample=${runConfig.sampleN}` : ''}`,
      );

      const benchmark = entry.build({
        reader,
        readerByTier,
        embedder,
        sessionSummarizer,
        sessionSummaryStore,
        sessionRetrievalTopSessions: runConfig.sessionRetrievalTopSessions,
        sessionRetrievalChunksPerSession: runConfig.sessionRetrievalChunksPerSession,
        hybridRetrievalEnabled: runConfig.hybridRetrieval,
        hydeEnabled: runConfig.hyde,
        factSupersessionEnabled: runConfig.factSupersession,
        splitAmbiguousThreshold: runConfig.splitAmbiguous,
        observerReflectorEnabled: runConfig.observerReflector,
        observerReflectorReplaceEnabled: runConfig.observerReflectorReplace,
        factGraphIngestEnabled: runConfig.factGraphIngest,
        graphActivationEnabled: runConfig.graphActivation,
        observationalMemoryEnabled: runConfig.observationalMemory,
      });
      const result = await runner.run(benchmark, runConfig);

      printRunSummary(result);
    });

  program
    .command('runs')
    .description('List saved benchmark runs with one-line summaries.')
    .option('--results-dir <path>', 'Results directory')
    .option('--benchmark <id>', 'Filter to a specific benchmark id')
    .option('--limit <n>', 'Show only the N most recent runs', parseInteger, 50)
    .action(async (opts) => {
      const { ResultStore } = await import('./core/ResultStore.js');
      const resultsDir = resolveResultsDir(opts.resultsDir);
      const store = new ResultStore(resultsDir);
      const summary = await store.readSummary();
      const entries = Object.values(summary.latest)
        .filter((e) => !opts.benchmark || e.benchmarkId === opts.benchmark)
        .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))
        .slice(0, opts.limit ?? 50);

      if (entries.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`No runs found under ${resultsDir}.`);
        return;
      }

      const pad = {
        bench: Math.max(...entries.map((e) => e.benchmarkId.length)),
        reader: Math.max(...entries.map((e) => e.reader.length)),
        memory: Math.max(...entries.map((e) => e.memoryMode.length)),
      };
      // eslint-disable-next-line no-console
      console.log(
        `${'benchmark'.padEnd(pad.bench)}  ${'reader'.padEnd(pad.reader)}  ${'memory'.padEnd(pad.memory)}  replay   acc    $/correct  runFile`,
      );
      for (const e of entries) {
        const acc = `${(e.accuracy * 100).toFixed(1).padStart(5)}%`;
        const cpc = Number.isFinite(e.costPerCorrect)
          ? `$${e.costPerCorrect.toFixed(4)}`
          : '       $∞';
        // eslint-disable-next-line no-console
        console.log(
          `${e.benchmarkId.padEnd(pad.bench)}  ${e.reader.padEnd(pad.reader)}  ${e.memoryMode.padEnd(pad.memory)}  ${e.replayMode.padEnd(7)}  ${acc}  ${cpc.padStart(10)}  ${e.runFile}`,
        );
      }
    });

  program
    .command('micro')
    .description('Run every micro-benchmark in one invocation (CI shortcut).')
    .option('--results-dir <path>', 'Results directory')
    .option('-c, --concurrency <n>', 'Per-benchmark concurrency', parseInteger, 3)
    .action(async (opts) => {
      const microEntries = BENCHMARKS.filter((b) => b.family === 'micro');
      const judge = {
        model: 'noop',
        rubricVersion: '0',
        async judge() {
          throw new Error('judge invoked on a micro-benchmark');
        },
      } as const;

      // Fresh MockReader per entry — micro-benchmarks never call it,
      // but the BenchEntry.build contract requires one.
      let failures = 0;
      const rows: Array<{ id: string; passed: number; total: number; acc: number; avgLatencyMs: number }> = [];
      for (const entry of microEntries) {
        const runner = new BenchmarkRunner({
          dataDir: resolveDataDir(opts.dataDir),
          resultsDir: resolveResultsDir(opts.resultsDir),
          judge,
        });
        const benchmark = entry.build({ reader: new MockReader('bench-micro') });
        try {
          const result = await runner.run(benchmark, {
            reader: 'claude-sonnet-4-6',
            memoryMode: 'none',
            replayMode: 'ingest',
            concurrency: opts.concurrency ?? 3,
          });
          rows.push({
            id: entry.id,
            passed: result.passedCases,
            total: result.totalCases,
            acc: result.accuracy,
            avgLatencyMs: result.avgLatencyMs,
          });
          if (result.passedCases < result.totalCases) failures += 1;
        } catch (err: unknown) {
          failures += 1;
          rows.push({ id: entry.id, passed: 0, total: 0, acc: 0, avgLatencyMs: 0 });
          // eslint-disable-next-line no-console
          console.error(`[${entry.id}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const pad = Math.max(...rows.map((r) => r.id.length));
      // eslint-disable-next-line no-console
      console.log('\nMicro-benchmark summary:');
      // eslint-disable-next-line no-console
      console.log(`${'benchmark'.padEnd(pad)}  result  passed/total   acc    avg latency`);
      for (const r of rows) {
        const ok = r.passed === r.total && r.total > 0;
        const mark = ok ? 'PASS' : 'FAIL';
        // eslint-disable-next-line no-console
        console.log(
          `${r.id.padEnd(pad)}  ${mark}    ${String(r.passed).padStart(3)}/${String(r.total).padStart(3)}   ${(r.acc * 100).toFixed(1).padStart(5)}%  ${r.avgLatencyMs.toFixed(1).padStart(6)} ms`,
        );
      }
      if (failures > 0) {
        // eslint-disable-next-line no-console
        console.error(`\n${failures} micro-benchmark(s) failed.`);
        process.exitCode = 1;
      }
    });

  program
    .command('setup')
    .description('Download benchmark datasets into the data cache.')
    .option('-b, --benchmark <id>', 'Download data for a single benchmark (default: all known)', 'all')
    .option('--data-dir <path>', 'Dataset cache directory')
    .option('--force', 'Re-download even if files already exist')
    .action(async (opts) => {
      const { downloadBenchmark, listDownloadableBenchmarks } = await import('./setup/download.js');
      const dataDir = resolveDataDir(opts.dataDir);
      const targets: string[] =
        opts.benchmark === 'all' ? listDownloadableBenchmarks() : [opts.benchmark as string];

      let failures = 0;
      for (const id of targets) {
        try {
          const results = await downloadBenchmark(id, dataDir, {
            force: Boolean(opts.force),
            onProgress: (msg) => {
              // eslint-disable-next-line no-console
              console.log(`[${id}] ${msg}`);
            },
          });
          for (const r of results) {
            // eslint-disable-next-line no-console
            console.log(
              `[${id}] ${r.skipped ? 'skipped' : 'downloaded'} ${r.filename} (${r.bytes} bytes) → ${r.absolutePath}`,
            );
          }
        } catch (err: unknown) {
          failures += 1;
          // eslint-disable-next-line no-console
          console.error(`[${id}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failures > 0) process.exitCode = 1;
    });

  program
    .command('export <runFile>')
    .description('Export a saved run as CSVs: <prefix>-cases.csv + <prefix>-evidence.csv')
    .option('--out <prefix>', 'Output prefix. Defaults to the run file path without .json')
    .action(async (runFile: string, opts) => {
      const { exportRunToCsv } = await import('./reporting/exportCsv.js');
      const fsp = await import('node:fs/promises');
      const result = JSON.parse(await fsp.readFile(runFile, 'utf8')) as import(
        './core/IBenchmark.js'
      ).BenchResult;
      const prefix = (opts.out as string | undefined) ?? runFile.replace(/\.json$/, '');
      const { casesPath, evidencePath } = await exportRunToCsv(result, prefix);
      // eslint-disable-next-line no-console
      console.log(`Wrote ${casesPath}`);
      // eslint-disable-next-line no-console
      console.log(`Wrote ${evidencePath}`);
    });

  program
    .command('compare <baselineRun> <challengerRun>')
    .description('Diff two run JSON files and print a Markdown-formatted comparison.')
    .option('--out <path>', 'Write the Markdown to this file instead of stdout')
    .action(async (baselineRun: string, challengerRun: string, opts) => {
      const { compareRuns: compare, formatComparisonMarkdown } = await import('./core/compareRuns.js');
      const fsp = await import('node:fs/promises');
      const baseline = JSON.parse(await fsp.readFile(baselineRun, 'utf8')) as import(
        './core/IBenchmark.js'
      ).BenchResult;
      const challenger = JSON.parse(await fsp.readFile(challengerRun, 'utf8')) as import(
        './core/IBenchmark.js'
      ).BenchResult;
      const diff = compare(baseline, challenger);
      const md = formatComparisonMarkdown(diff);
      if (opts.out) {
        await fsp.writeFile(opts.out, md);
        // eslint-disable-next-line no-console
        console.log(`Wrote ${opts.out}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(md);
      }
    });

  program
    .command('leaderboard')
    .description('Regenerate LEADERBOARD.md from results/summary.json + competitor-numbers.')
    .option('--results-dir <path>', 'Results directory')
    .option('--filename <name>', 'Output filename', 'LEADERBOARD.md')
    .option('--note <text>', 'Optional header note appended under the title')
    .action(async (opts) => {
      const { renderLeaderboard } = await import('./reporting/MarkdownLeaderboard.js');
      const outPath = await renderLeaderboard({
        resultsDir: resolveResultsDir(opts.resultsDir),
        filename: opts.filename,
        headerNote: opts.note,
      });
      // eslint-disable-next-line no-console
      console.log(`Wrote ${outPath}`);
    });

  program
    .command('sweep-report')
    .description('Render a narrative SWEEP_REPORT.md consolidating every tracked cell.')
    .option('--results-dir <path>', 'Results directory')
    .option('--filename <name>', 'Output filename', 'SWEEP_REPORT.md')
    .option('--label <text>', 'Optional sweep label (e.g. "Phase 0.1 smoke")')
    .option(
      '--recompute-ci',
      'Re-compute bootstrap CIs over existing run JSONs and overwrite them in place. No API calls; reads the per-case scores already stored in each run file.',
    )
    .option(
      '--recompute-ci-seed <n>',
      'Seed for deterministic CI re-computation. Default: 42.',
      parseInteger,
      42,
    )
    .option(
      '--recompute-ci-resamples <n>',
      'Bootstrap resamples for recompute. Default: 10000.',
      parsePositiveInteger,
      10_000,
    )
    .action(async (opts) => {
      const resultsDir = resolveResultsDir(opts.resultsDir);
      if (opts.recomputeCi) {
        const { recomputeCIsForResultsDir } = await import(
          './reporting/sweepReport.js'
        );
        const touched = await recomputeCIsForResultsDir(resultsDir, {
          seed: opts.recomputeCiSeed as number | undefined,
          resamples: opts.recomputeCiResamples as number | undefined,
        });
        // eslint-disable-next-line no-console
        console.log(
          `Recomputed CIs for ${touched} run file(s) in ${resultsDir}`,
        );
        return;
      }
      const { renderSweepReport } = await import('./reporting/sweepReport.js');
      const outPath = await renderSweepReport({
        resultsDir,
        filename: opts.filename,
        label: opts.label,
      });
      // eslint-disable-next-line no-console
      console.log(`Wrote ${outPath}`);
    });

  return program;
}

// Invoke only when executed as a script.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildCli()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
