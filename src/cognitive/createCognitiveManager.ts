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
import { CognitiveMemoryManager, SqliteBrain, SqliteKnowledgeGraph } from '@framers/agentos';
import type { HexacoTraits, PADState } from '@framers/agentos';
import type { IEmbeddingManager } from '@framers/agentos/core/embeddings/IEmbeddingManager';
import { InMemoryVectorStore } from '@framers/agentos/rag/vector_stores/InMemoryVectorStore';
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
    // Consolidation loop would spawn timers we don't want in a
    // short-lived per-case run. Disable it for benchmark cases.
    consolidation: { enabled: false } as unknown as import('@framers/agentos').CognitiveMemoryConfig['consolidation'],
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

  return { manager, brain, close };
}
