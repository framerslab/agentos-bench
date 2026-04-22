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
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new LongMemEvalS({ reader, variant: 's', embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
  {
    id: 'longmemeval-m',
    family: 'external',
    description: 'LongMemEval-M (~500 sessions per haystack) — medium-difficulty variant',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new LongMemEvalM({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
  {
    id: 'longmemeval-oracle',
    family: 'external',
    description: 'LongMemEval-Oracle (evidence-only) — isolates reader quality from retrieval',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new LongMemEvalOracle({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
  {
    id: 'locomo',
    family: 'external',
    description: 'LOCOMO (Maharana et al. 2024, 10 convos × ~300 turns, QA task only in v1)',
    build: ({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }) =>
      new Locomo({ reader, embedder, sessionSummarizer, sessionSummaryStore, sessionRetrievalTopSessions, sessionRetrievalChunksPerSession, hybridRetrievalEnabled, hydeEnabled, factSupersessionEnabled, splitAmbiguousThreshold, observerReflectorEnabled, observerReflectorReplaceEnabled, factGraphIngestEnabled, graphActivationEnabled }),
  },
  {
    id: 'beam-500k',
    family: 'external',
    description: 'BEAM 500k tier (placeholder — upstream schema not yet public)',
    build: ({ reader }) => new Beam({ reader, tier: '500k' }),
  },
  {
    id: 'beam-1m',
    family: 'external',
    description: 'BEAM 1M tier (placeholder — upstream schema not yet public)',
    build: ({ reader }) => new Beam({ reader, tier: '1m' }),
  },
  {
    id: 'beam-10m',
    family: 'external',
    description: 'BEAM 10M tier — frontier, Hindsight SOTA (placeholder until schema is published)',
    build: ({ reader }) => new Beam({ reader, tier: '10m' }),
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
    case 'beam-500k':
    case 'beam-1m':
    case 'beam-10m':
      return 100;
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
      'Enable Step-13 graph activation wire-up. Heuristic regex entity extraction (zero LLM) at ingest populates trace.entities and creates co-occurrence edges in SqliteKnowledgeGraph. At retrieve, Anderson spreading activation seeded from query entities computes the sixth composite-score signal (weight 0.10 in RetrievalPriorityScorer, previously hardcoded to 0). Additive, deterministic, dodges the n=8 LLM-mediated-content RED pattern by construction.',
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
      };

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
