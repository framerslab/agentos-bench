/**
 * @file createCognitiveManager.ts
 * @description Factory that wires a real {@link CognitiveMemoryManager}
 * with minimal dependencies suitable for benchmark runs.
 *
 * Dependencies:
 *   - `SqliteBrain` (in-temp-file) — durable backing for the knowledge
 *     graph and memory graph. The benchmark writes one brain file per
 *     case under `ctx.scratchDir`, then deletes it.
 *   - `SqliteKnowledgeGraph(brain)` — real IKnowledgeGraph (not a mock).
 *   - `InMemoryVectorStore` — fast, dependency-free vector store for
 *     hot-path retrieval. Ephemeral by design — the benchmark does not
 *     need cross-run persistence for the vector index.
 *   - `MinimalWorkingMemoryBacking` — in-process IWorkingMemory stub.
 *   - `CharHashEmbedder` — deterministic lexical embedder. Callers can
 *     inject a real embedder via options to publish real numbers.
 *
 * The returned object exposes `manager`, plus `close()` for teardown
 * (closes the brain and deletes the underlying SQLite file).
 *
 * @module agentos-bench/cognitive/createCognitiveManager
 */

import { promises as fs } from 'node:fs';
import {
  CognitiveMemoryManager,
  SqliteBrain,
  SqliteKnowledgeGraph,
  FactExtractor,
  FactStore,
} from '@framers/agentos';
import type { HexacoTraits, PADState } from '@framers/agentos';
import type { IEmbeddingManager } from '@framers/agentos/core/embeddings/IEmbeddingManager';
import { InMemoryVectorStore } from '@framers/agentos/rag/vector_stores/InMemoryVectorStore';
import {
  RerankerService,
  CohereReranker,
  type CohereRerankerModel,
} from '@framers/agentos/rag/reranking';
import { CharHashEmbedder, CHAR_HASH_DIM } from './charHashEmbedder.js';
import { MinimalWorkingMemoryBacking } from '../micro/support/MinimalWorkingMemoryBacking.js';

/** Neutral HEXACO traits — every dimension at 0.5. */
export const NEUTRAL_TRAITS: HexacoTraits = {
  honesty: 0.5,
  emotionality: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  conscientiousness: 0.5,
  openness: 0.5,
} as HexacoTraits;

/** Neutral PAD mood — no emotional bias. */
export const NEUTRAL_MOOD: PADState = { valence: 0, arousal: 0, dominance: 0 };

/**
 * Options for {@link createCognitiveManager}.
 */
export interface CreateCognitiveManagerOptions {
  /**
   * Absolute path where the brain SQLite file will be created. The
   * caller is responsible for ensuring the parent directory exists.
   */
  brainPath: string;
  /** Agent identifier. Default: `'bench-agent'`. */
  agentId?: string;
  /** HEXACO traits. Default: {@link NEUTRAL_TRAITS}. */
  traits?: HexacoTraits;
  /** Static mood provider. Default: always {@link NEUTRAL_MOOD}. */
  mood?: PADState;
  /**
   * Optional real embedder — inject an OpenAI / Ollama-backed
   * implementation for publishable benchmark numbers. Defaults to the
   * char-hash stub so tests run offline.
   */
  embedder?: IEmbeddingManager;
  /**
   * Optional name of a cognitive mechanism to disable for this run.
   * Passed through as `cognitiveMechanisms.<name>.enabled = false`
   * on the resulting manager. Used for per-mechanism ablation studies.
   */
  disableMechanism?:
    | 'reconsolidation'
    | 'retrievalInducedForgetting'
    | 'involuntaryRecall'
    | 'metacognitiveFOK'
    | 'temporalGist'
    | 'schemaEncoding'
    | 'sourceConfidenceDecay'
    | 'emotionRegulation';

  /**
   * Optional Cohere reranker configuration. When set, the resulting
   * {@link CognitiveMemoryManager} gets a {@link RerankerService}
   * wired with a single {@link CohereReranker} provider. The manager
   * then blends 0.7 cognitive + 0.3 neural scores on every retrieve.
   *
   * Leave undefined to disable neural reranking (bench default).
   */
  reranker?: {
    /** Provider — currently only 'cohere' is wired in the bench. */
    provider: 'cohere';
    /** Cohere API key. Typically `process.env.COHERE_API_KEY`. */
    apiKey: string;
    /** Cohere rerank model ID. Default: `'rerank-v3.5'`. */
    model?: CohereRerankerModel;
  };

  /**
   * Optional LLM invoker (Step 4). When set, triggers auto-construction
   * of a {@link MemoryHydeRetriever} inside
   * `CognitiveMemoryManager.initialize()`. Wired to
   * `featureDetectionLlmInvoker` so it does not activate the
   * observer/reflector side effects.
   *
   * Leave undefined to keep HyDE disabled (bench default). When set,
   * callers must also pass `options.hyde: true` on the
   * `manager.retrieve` call (or use a `HybridRetriever` with
   * `hydeRetriever` set) for the HyDE path to actually execute.
   */
  hydeLlmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;

  /**
   * Step-7 (Tier 2): LLM invoker for Observer/Reflector pipeline. When
   * set, `manager.initialize` receives `observer: { llmInvoker }` and
   * `reflector: { llmInvoker }` so the three-tier pipeline activates.
   * Typically wraps a cheap reader (gpt-5-mini) with cost tracking.
   *
   * Leave undefined to keep the Observer/Reflector pipeline dormant
   * (bench default pre-Step-7).
   */
  observerReflectorLlmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;

  /**
   * Step-9 (Tier 3): LLM invoker for Mem0-style fact-graph ingest.
   * When set, the returned handle carries a fresh {@link FactStore}
   * plus a {@link FactExtractor} wired with this invoker. The adapter
   * calls `factExtractor.extract(session)` at session-ingest time,
   * upserts the resulting facts into `factStore`, and threads the
   * store into `HybridRetriever` so synthetic fact-graph traces are
   * prepended to the merged pool before rerank.
   *
   * Typically wraps a cheap reader (gpt-5-mini). Leave undefined to
   * keep the fact-graph path dormant (bench default pre-Step-9).
   */
  factExtractorLlmInvoker?: (systemPrompt: string, userPrompt: string) => Promise<string>;

  /**
   * Step-13: enable graph activation. Propagates to
   * `MemoryStoreConfig.enableGraphActivation`. When true, the underlying
   * `MemoryStore` upserts entity nodes + `related_to:co_occurs` relations
   * at encode, and seeds Anderson spreading activation from query
   * entities at retrieve. Activates the sixth composite-scoring signal
   * (weight 0.10, previously a silent zero).
   *
   * Default: false. Bench sets this when `--graph-activation` is passed.
   */
  enableGraphActivation?: boolean;
}

/**
 * Handle to a fully-wired cognitive memory stack. Call `close()` to
 * release the SQLite file.
 */
export interface BenchCognitiveHandle {
  /** The manager ready for `encode` / `observe` / `retrieve`. */
  manager: CognitiveMemoryManager;
  /** Brain instance — exposed so callers can read low-level state. */
  brain: SqliteBrain;
  /**
   * Close the manager and delete the underlying SQLite brain file.
   * Idempotent — safe to call multiple times.
   */
  close: () => Promise<void>;
  /**
   * Step-9: per-case {@link FactStore}. Populated when
   * {@link CreateCognitiveManagerOptions.factExtractorLlmInvoker} is
   * set. Adapters upsert into this store at session-ingest time and
   * pass it through to `HybridRetriever`.
   */
  factStore?: FactStore;
  /**
   * Step-9: per-case {@link FactExtractor}. Populated alongside
   * {@link factStore} when the LLM invoker is provided.
   */
  factExtractor?: FactExtractor;
}

/**
 * Construct a {@link CognitiveMemoryManager} with real SQLite storage,
 * an in-memory vector store, and a char-hash (or injected) embedder.
 */
export async function createCognitiveManager(
  opts: CreateCognitiveManagerOptions,
): Promise<BenchCognitiveHandle> {
  const brain = await SqliteBrain.open(opts.brainPath);

  const knowledgeGraph = new SqliteKnowledgeGraph(brain);
  await knowledgeGraph.initialize();

  const vectorStore = new InMemoryVectorStore();
  await vectorStore.initialize({
    id: 'bench-vector',
    type: 'in_memory',
    defaultEmbeddingDimension: CHAR_HASH_DIM,
    similarityMetric: 'cosine',
  } as import('@framers/agentos/core/vector-store/IVectorStore').VectorStoreProviderConfig);

  const workingMemory = new MinimalWorkingMemoryBacking();
  await workingMemory.initialize(opts.agentId ?? 'bench-agent');

  const embeddingManager = opts.embedder ?? new CharHashEmbedder();
  const mood = opts.mood ?? NEUTRAL_MOOD;

  const cognitiveMechanisms = opts.disableMechanism
    ? ({ [opts.disableMechanism]: { enabled: false } } as
        import('@framers/agentos').CognitiveMemoryConfig['cognitiveMechanisms'])
    : undefined;

  // Wire an optional neural reranker. CognitiveMemoryManager already
  // knows how to blend Cohere / local cross-encoder scores with the
  // cognitive composite (0.7 cog + 0.3 neural); we just hand it a
  // service instance with one Cohere provider registered. Declining
  // gracefully when apiKey is missing keeps bench runs from crashing
  // on the common "no COHERE_API_KEY set" path.
  let rerankerService: RerankerService | undefined;
  if (opts.reranker && opts.reranker.apiKey) {
    rerankerService = new RerankerService({
      config: {
        providers: [
          {
            providerId: 'cohere',
            apiKey: opts.reranker.apiKey,
            defaultModelId: opts.reranker.model ?? 'rerank-v3.5',
          },
        ],
        defaultProviderId: 'cohere',
      },
    });
    rerankerService.registerProvider(
      new CohereReranker({
        providerId: 'cohere',
        apiKey: opts.reranker.apiKey,
        defaultModelId: opts.reranker.model ?? 'rerank-v3.5',
      }),
    );
  }

  const manager = new CognitiveMemoryManager();
  await manager.initialize({
    workingMemory,
    knowledgeGraph,
    vectorStore,
    embeddingManager,
    agentId: opts.agentId ?? 'bench-agent',
    traits: opts.traits ?? NEUTRAL_TRAITS,
    moodProvider: () => mood,
    featureDetectionStrategy: 'keyword',
    brain,
    cognitiveMechanisms,
    rerankerService,
    featureDetectionLlmInvoker: opts.hydeLlmInvoker,
    observer: opts.observerReflectorLlmInvoker
      ? { llmInvoker: opts.observerReflectorLlmInvoker }
      : undefined,
    reflector: opts.observerReflectorLlmInvoker
      ? { llmInvoker: opts.observerReflectorLlmInvoker }
      : undefined,
    // Consolidation loop would spawn timers we don't want in a
    // short-lived per-case run. Disable it for benchmark cases.
    consolidation: { enabled: false } as unknown as import('@framers/agentos').CognitiveMemoryConfig['consolidation'],
    // Step 13: opt-in to graph activation wire-up.
    enableGraphActivation: opts.enableGraphActivation ?? false,
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await brain.close?.();
    } catch {
      /* already closed */
    }
    await fs.rm(opts.brainPath, { force: true }).catch(() => {});
  };

  // Step-9: wire fact-graph ingest when the invoker is provided.
  // Per-case FactStore is ephemeral — lives as long as the handle.
  const factStore = opts.factExtractorLlmInvoker ? new FactStore() : undefined;
  const factExtractor = opts.factExtractorLlmInvoker
    ? new FactExtractor({
        llmInvoker: opts.factExtractorLlmInvoker,
        cacheFingerprint: 'fact-graph-ingest:gpt-5-mini:v1',
      })
    : undefined;

  return { manager, brain, close, factStore, factExtractor };
}
