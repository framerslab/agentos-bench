# AgentOS Bench — Session Handoff (2026-04-19)

A complete picture of what exists, what works, what doesn't, and where to pick up.

---

## 0. TL;DR

**`@framers/agentos-bench`** is a memory-benchmark suite under `packages/agentos-bench/`. It drives AgentOS's cognitive memory through LongMemEval, LOCOMO, and BEAM-placeholder adapters, plus 7 micro-benchmarks that pin the cognitive-science claims of the memory stack.

- **81 tests across 20 files**, all passing, typecheck clean, build clean.
- **CI workflow** gates every PR on micros + mocked external integration tests.
- **First real LongMemEval-S pilot** (20 cases, GPT-4o reader + judge, text-embedding-3-small, full-cognitive + ingest) scored **40% accuracy, $1.37 total, $0.17/correct**. Real numbers, committed to `results/runs/`.
- **Published competitor SOTA on LongMemEval-S**: agentmemory **96.2%** (GPT-4o), Mastra OM **94.87%** (GPT-5-mini) / **84.23%** (GPT-4o), Supermemory ~92%, Emergence AI 78%.
- **Gap is the memory architecture, not the reader.** Initial ingest replay put whole sessions into single traces (~3k tokens), diluting embeddings and burying hero memories. The new per-turn-pair chunking (landed 2026-04-19) is the fix; pilots with it were running at handoff time.

---

## 1. Package surface — everything shipped

### 1.1 Layout

```
packages/agentos-bench/
├── package.json                      @framers/agentos-bench@0.1.0
├── tsconfig.json
├── vitest.config.ts
├── .gitignore                        ignores data/ (downloaded datasets) + dist/
├── HANDOFF.md                        this file
├── src/
│   ├── index.ts                      public barrel
│   ├── cli.ts                        commander-based CLI (list / run / runs / micro /
│   │                                 setup / export / compare / leaderboard)
│   ├── core/
│   │   ├── IBenchmark.ts             contracts: IBenchmark, BenchCase, BenchContext,
│   │   │                             CaseRun, CaseResult, BenchResult, RunConfig
│   │   ├── BenchmarkRunner.ts        concurrent case loop, two-stage caching
│   │   ├── Cache.ts                  SHA-256 filesystem cache for answers + judgments
│   │   ├── CostTracker.ts            per-category USD accounting, MODEL_PRICES,
│   │   │                             versioned-name fallback, ensureBudget
│   │   ├── ResultStore.ts            per-run JSON + rolling summary.json
│   │   ├── ConversationReplay.ts     observe / ingest helpers
│   │   ├── compareRuns.ts            pure-function run diff + Markdown formatter
│   │   ├── estimateRunCost.ts        offline cost preflight
│   │   ├── rescoreRunCosts.ts        post-hoc USD re-pricing
│   │   ├── statsUtil.ts              percentile / stdDev
│   │   └── index.ts                  barrel
│   ├── judges/
│   │   ├── IJudge.ts                 JudgeInput / JudgeOutput contract
│   │   ├── LongMemEvalJudge.ts       LLM-as-judge delegating to an IReader
│   │   └── rubrics/
│   │       └── longmemeval.ts        vendored per-type rubrics (MIT, RUBRIC_VERSION)
│   ├── readers/
│   │   ├── IReader.ts                minimal LLM invocation contract
│   │   ├── MockReader.ts             route-based deterministic mock for tests
│   │   └── createReader.ts           thin fetch-based OpenAI + Anthropic HTTP clients
│   ├── cognitive/
│   │   ├── charHashEmbedder.ts       FNV-1a deterministic lexical IEmbeddingManager
│   │   ├── OpenAIEmbedder.ts         IEmbeddingManager delegating to agentos embedText
│   │   │                             (inherits provider-agnostic dispatch)
│   │   ├── createCognitiveManager.ts SqliteBrain + SqliteKnowledgeGraph +
│   │   │                             InMemoryVectorStore + MinimalWorkingMemoryBacking
│   │   │                             + CognitiveMemoryManager
│   │   └── index.ts                  barrel
│   ├── benchmarks/
│   │   ├── longmemeval/
│   │   │   ├── dataset.ts            HF JSON parsing, answer normalization
│   │   │   │                         (handles string | number | bool | array)
│   │   │   ├── LongMemEvalS.ts       main adapter + shared runFullCognitiveCase +
│   │   │   │                         chunkSessionTurns (per-turn-pair chunking)
│   │   │   └── index.ts              exports + LongMemEvalM / LongMemEvalOracle
│   │   ├── locomo/
│   │   │   ├── dataset.ts            session_<i> / session_<i>_date_time parsing
│   │   │   ├── Locomo.ts             QA-task adapter, reuses runFullCognitiveCase
│   │   │   └── index.ts
│   │   └── beam/
│   │       ├── Beam.ts               placeholder throwing BeamUnimplementedError
│   │       └── index.ts
│   ├── micro/
│   │   ├── DecayFidelity.ts                5 probes on Ebbinghaus curve
│   │   ├── HexacoEncodingBias.ts           6 HEXACO traits × encoding direction
│   │   ├── WorkingMemoryCapacity.ts        5 Baddeley-slot scenarios
│   │   ├── SpreadingActivationPrecision.ts 3 synthetic-cluster seeds
│   │   ├── ConsolidationSignalPreservation.ts  3 flashbulb-immunity mechanisms
│   │   ├── ScalingProfile.ts               2 sizes (1k, 10k)
│   │   ├── SignalAblation.ts               6 signals ablated one at a time
│   │   └── support/
│   │       └── MinimalWorkingMemoryBacking.ts  in-memory IWorkingMemory
│   ├── reporting/
│   │   ├── MarkdownLeaderboard.ts          renders LEADERBOARD.md
│   │   ├── competitor-numbers.ts           vendored SOTA numbers with citations
│   │   ├── exportCsv.ts                    cases.csv + evidence.csv
│   │   └── index.ts
│   └── setup/
│       └── download.ts               HF + GitHub raw dataset downloads
├── tests/
│   └── 20 *.spec.ts files (see §1.3)
└── results/                          committed
    ├── LEADERBOARD.md
    ├── summary.json                  rolling summary keyed by
    │                                 (benchmarkId, reader, memoryMode, replayMode)
    ├── runs/                         external-benchmark run JSONs + CSVs
    └── micro/                        micro-benchmark run JSONs
```

### 1.2 Commits on master (bench-specific)

```
811311a02c  feat(agentos-bench): scaffold memory benchmark suite
ff78ae8a87  feat(agentos-bench): add three cognitive-mechanism micro-benchmarks
65bb33c864  feat(agentos-bench): add LongMemEval judge, readers, adapter, and CLI
8cf0af532b  feat(agentos-bench): add leaderboard generator and competitor registry
23919224c0  feat(agentos-bench): wire base-memory path in LongMemEvalS adapter
b3f3a5182c  feat(agentos-bench): add LongMemEval-M/Oracle variants and LOCOMO adapter
9ac9110109  feat(agentos-bench): add SignalAblation micro-benchmark
0940057f90  feat(agentos-bench): dataset auto-download for setup command
e97fb4a3a1  feat(agentos-bench): CI workflow and BEAM placeholder adapter
4870864d84  feat(agentos-bench): wire full-cognitive memory mode in adapters
dfafb97bce  fix(agentos-bench): --dry-run now swaps the reader, not just the judge
43adb417e6  feat(agentos-bench): per-type breakdown + latency percentiles in CLI run output
0e274de40a  feat(agentos-bench): compareRuns helper + cognitive-vs-base divergence test
972b999d1f  feat(agentos-bench): cost preflight, runs listing, micro shortcut
88eb8acde9  chore(agentos-bench): first real benchmark results (micros)
a7df0d7029  chore: sync wilds-ai + agentos-bench work (OpenAIEmbedder, CSV export,
             dataset schema fix for numeric answers)
99fe9c98da  feat(agentos-bench): first real LongMemEval-S row + cost-tracker fixes
             (40% @ 20 cases, versioned-name fallback, rescoreRunCosts,
              per-turn-pair chunking landed but pilots hadn't re-run yet)
```

### 1.3 Test inventory (20 files, 81 tests)

| Spec | Tests | What it pins |
|---|---:|---|
| `tests/DecayFidelity.spec.ts` | 3 | Ebbinghaus formula, runner integration, persistence |
| `tests/HexacoEncodingBias.spec.ts` | 1 | 6 traits × predicted direction |
| `tests/WorkingMemoryCapacity.spec.ts` | 1 | Baddeley 5–9 + LRU eviction |
| `tests/SpreadingActivationPrecision.spec.ts` | 1 | ≥80% cluster containment |
| `tests/ConsolidationSignalPreservation.spec.ts` | 1 | Flashbulb immunity across 3 mechanisms |
| `tests/ScalingProfile.spec.ts` | 1 | 1k / 10k latency budgets |
| `tests/SignalAblation.spec.ts` | 2 | Every retrieval signal is load-bearing + NDCG helper |
| `tests/LongMemEvalS.integration.spec.ts` | 3 | End-to-end + full-cognitive success |
| `tests/LongMemEvalS.baseMemory.spec.ts` | 2 | Memory.recall → prompt, brain file cleanup |
| `tests/LongMemEvalS.fullCognitive.spec.ts` | 3 | Full-cognitive works + diverges from base-memory |
| `tests/Locomo.integration.spec.ts` | 3 | LOCOMO parsing + category types |
| `tests/Beam.placeholder.spec.ts` | 11 | Fail-fast sentinel across 3 tiers |
| `tests/MarkdownLeaderboard.spec.ts` | 3 | Section shape, bestPublished, row order |
| `tests/compareRuns.spec.ts` | 6 | Winner, deltas, unmatched |
| `tests/estimateRunCost.spec.ts` | 6 | Micro=$0, scaling, sampleN, memory-mode savings, warnings |
| `tests/CostTracker.spec.ts` | 7 | Known prices, **versioned-name fallback**, budget |
| `tests/download.spec.ts` | 6 | Cache hits, force, HTTP errors, URL allowlist |
| `tests/cli.smoke.spec.ts` | 8 | list / run / runs / micro / preflight abort / full-cognitive |
| `tests/exportCsv.spec.ts` | 5 | Cases CSV, evidence CSV, RFC-4180 escaping |
| `tests/OpenAIEmbedder.spec.ts` | 9 | Delegates to agentos embedText, env-var handling |
| `tests/chunkSessionTurns.spec.ts` | 6 | Per-turn-pair grouping + lone-user + system/tool attach |

Run: `cd packages/agentos-bench && pnpm vitest run`.
Typecheck: `pnpm typecheck`.
Build: `pnpm build`.

### 1.4 CLI subcommands

```bash
agentos-bench list                           # enumerate registered benchmarks
agentos-bench setup [--benchmark id]         # download datasets (HF + GitHub raw)
agentos-bench run <id>                       # execute one benchmark
                                             # flags:
                                             #   --reader <model>           claude-sonnet-4-6 (default)
                                             #   --judge-model <model>       gpt-4o (default)
                                             #   --embedder-model <model>    openai:text-embedding-3-small
                                             #   --memory <mode>             none | base-memory | full-cognitive
                                             #   --replay <mode>             observe | ingest
                                             #   --sample <n>                cap case count
                                             #   --concurrency <n>           parallel cases (default 3)
                                             #   --max-usd <amount>          hard cap, aborts preflight
                                             #   --data-dir <path>           dataset cache (default ./data)
                                             #   --results-dir <path>        output dir  (default ./results)
                                             #   --dry-run                   MockReader + MockJudge, no API
agentos-bench runs [--benchmark id] [--limit n]  list saved runs
agentos-bench micro                          # run every micro-benchmark
agentos-bench export <runFile> [--out <prefix>]    # -cases.csv + -evidence.csv
agentos-bench compare <baseline> <challenger> [--out <md>]  # RunComparison
agentos-bench leaderboard [--note "..."]     # regenerate LEADERBOARD.md
```

---

## 2. Real benchmark results

### 2.1 Micro-benchmark suite (30 probes, all passing)

See `packages/agentos-bench/results/micro/*.json` for per-probe detail.

| Benchmark | Probes | Outcome |
|---|---:|---|
| decay-fidelity | 5 | 100% — Ebbinghaus within ±2% |
| hexaco-encoding-bias | 6 | 100% — every trait biases encoding |
| working-memory-capacity | 5 | 100% — Baddeley 5–9 + LRU |
| spreading-activation-precision | 3 | 100% — ≥80% cluster retention |
| consolidation-signal-preservation | 3 | 100% — flashbulb immunity |
| scaling-profile | 2 | 100% — 1k: 0.3ms p50 / 10k: 16ms p50 |
| signal-ablation | 6 | 100% — every signal is load-bearing |

Command: `node dist/cli.js micro --results-dir ./results`.

### 2.2 LongMemEval-S pilot #1 (pre-chunking fix)

File: `results/runs/2026-04-19T06-49-58-505--longmemeval-s--gpt-4o--full-cognitive--ingest.json`

| Config | Value |
|---|---|
| Benchmark | longmemeval-s |
| Reader | gpt-4o |
| Judge | gpt-4o |
| Embedder | openai:text-embedding-3-small (1536 dim) |
| Memory | full-cognitive |
| Replay | ingest (per-session — old chunking) |
| Cases | 20 (sample) |
| Accuracy | **40.0%** (8/20) |
| Total USD | $1.37 |
| Cost per correct | $0.17 |
| Avg latency | 14.5s |
| p95 latency | 16.4s |
| Reader tokens | 527,956 |

Per-type breakdown (all cases happened to be `single-session-user`): 40% / avgScore 0.40.

### 2.3 Competitors (LongMemEval-S, published)

| System | Reader | Accuracy | Source |
|---|---|---:|---|
| agentmemory (JordanMcCann) | GPT-4o | 96.2% | https://github.com/JordanMcCann/agentmemory |
| Mastra Observational Memory | GPT-5-mini | 94.87% | https://mastra.ai/research/observational-memory |
| Mastra Observational Memory | GPT-4o | 84.23% | same |
| Supermemory | Unspecified | ~92% | https://supermemory.ai/research/ |
| Emergence AI | GPT-4o | 78% | https://www.emergence.ai/blog/sota-on-longmemeval-with-rag |

### 2.4 Failure-mode analysis

From `results/runs/*-cases.csv` and `*-evidence.csv`:

- **Case `e47becba`** — question specific, top retrieval score 0.33 (weak), content about "gender diversity" (unrelated). Model: "I don't know."
- **Case `118b2229`** — same pattern. Top hit 0.43 about "task planning" when question was about something else. Model: "I don't know."
- **Case `51a45a95`** — returned a confident answer ("$5 coupon on coffee creamer from email inbox") but the judge said no (wrong detail).

Root cause — per-session ingest meant **one trace per session (~3k tokens)**, which buried the hero memory (1–2 sentences) alongside many unrelated turns. Embedding dilution made retrieval score the correct session nearly the same as unrelated sessions.

### 2.5 Fix landed (per-turn-pair chunking)

`chunkSessionTurns` in `src/benchmarks/longmemeval/LongMemEvalS.ts`:

- Groups each `user → assistant` exchange into its own chunk
- Lone user turns at session end become their own chunk
- System / tool turns attach to the in-flight chunk

Each chunk is now ~300–600 tokens (3–10× smaller than per-session). 6 unit tests pin the shape.

**Pilot #2 (chunking-fix) was running in the background at handoff time.** Pick it up from `/tmp/pilot-v2-results/runs/` if the process is still active, or re-run with:

```bash
set -a && source apps/wilds-ai/.env.local && set +a
AGENTOS_BENCH_DATA_DIR=packages/agentos-bench/data \
AGENTOS_BENCH_RESULTS_DIR=/tmp/pilot-v2-results \
node packages/agentos-bench/dist/cli.js run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o --memory full-cognitive --replay ingest \
  --sample 20 --embedder-model openai:text-embedding-3-small \
  --max-usd 3 --concurrency 4
```

Expected cost: ~$1.40. Expected runtime: 3–8 minutes depending on OpenAI latency.

---

## 3. AgentOS memory stack — what the bench drives

### 3.1 Three-tier API

| Tier | Entry point | Use case |
|---|---|---|
| **Standalone** | `Memory.create({ path })` in `src/memory/io/facade/Memory.ts` | SQLite-first memory, zero-dep, no LLM required |
| **Cognitive** | `new CognitiveMemoryManager(); await mgr.initialize(config)` in `src/memory/CognitiveMemoryManager.ts` | Full 6-signal + 8-mechanism cognitive stack |
| **Facade** | `AgentMemory.wrap(mgr)` / `AgentMemory.sqlite(cfg)` in `src/memory/AgentMemory.ts` | Developer-friendly wrapper over either backend |

### 3.2 CognitiveMemoryManager — the star feature

Configured via `CognitiveMemoryConfig` (`src/memory/core/config.ts:212`). Required fields:

- `workingMemory: IWorkingMemory` — Baddeley slot-based working memory
- `knowledgeGraph: IKnowledgeGraph` — entity + relation store
- `vectorStore: IVectorStore` — dense retrieval backend
- `embeddingManager: IEmbeddingManager` — pluggable embedder
- `agentId: string`, `traits: HexacoTraits`, `moodProvider: () => PADState`
- `featureDetectionStrategy: 'keyword' | 'llm' | 'hybrid'`

Optional:

- `brain: SqliteBrain` — durable persistence
- `observer` / `reflector` — require `llmInvoker`; produce higher-quality observations + reflective consolidation
- `consolidation` — periodic prune/merge/strengthen/derive loop
- `cognitiveMechanisms` — enables the 8 extensions
- `infiniteContext`, `maxContextTokens` — transparent compaction for forever conversations
- `rerankerService` — post-retrieval quality improvement (see §4.5)
- `archive` — write-ahead verbatim preservation

Key methods:

| Method | Signature | When to call |
|---|---|---|
| `encode` | `(input, mood, gmiMood, opts?)` | Explicit trace creation (bench uses this) |
| `observe` | `(role, content, mood?)` | Per-turn in live conversations — **no-op without observer** |
| `retrieve` | `(query, mood, opts: CognitiveRetrievalOptions)` | Returns 6-signal-scored traces + diagnostics |
| `assembleForPrompt` | `(opts)` | Token-budgeted context assembly for system prompt |
| `runConsolidation` | `()` | Force consolidation sweep |
| `getWorkingMemory` | `()` | Returns CognitiveWorkingMemory |

The bench's `createCognitiveManager()` (in `src/cognitive/createCognitiveManager.ts`) wires a minimal working configuration:

```
brain         = await SqliteBrain.open(brainPath)
knowledgeGraph = new SqliteKnowledgeGraph(brain); await kg.initialize()
vectorStore   = new InMemoryVectorStore(); await vs.initialize({ type: 'in_memory', defaultEmbeddingDimension })
workingMemory = new MinimalWorkingMemoryBacking(); await wm.initialize(agentId)
embeddingManager = opts.embedder ?? new CharHashEmbedder()
manager       = new CognitiveMemoryManager()
await manager.initialize({ workingMemory, knowledgeGraph, vectorStore, embeddingManager,
                           agentId, traits: NEUTRAL_TRAITS,
                           moodProvider: () => NEUTRAL_MOOD,
                           featureDetectionStrategy: 'keyword',
                           brain,
                           consolidation: { enabled: false } })
```

### 3.3 The 6-signal retrieval scorer

`scoreAndRankTraces` in `src/memory/core/decay/RetrievalPriorityScorer.ts:99`. Default weights:

| Signal | Weight | What drives it |
|---|---:|---|
| `similarity` | 0.35 | Vector cosine against the query embedding |
| `strength` | 0.25 | `computeCurrentStrength(trace, now)` — Ebbinghaus `S₀·e^(-Δt/stability)` |
| `emotionalCongruence` | 0.15 | PAD valence product with trace valence |
| `recency` | 0.10 | `(1 + 0.2·e^(-elapsed/halfLife))` normalized |
| `graphActivation` | 0.10 | Spreading activation from seed nodes |
| `importance` | 0.05 | `trace.provenance.confidence * 0.5 + 0.5` |

Every signal produces a measurable NDCG drop when zeroed (proven by `signal-ablation` micro).

### 3.4 The 8 cognitive mechanisms

`src/memory/mechanisms/`. All on by default; configurable via `CognitiveMemoryConfig.cognitiveMechanisms`.

Retrieval-time (synchronous):

1. **Reconsolidation** — retrieved traces drift toward current mood
2. **Retrieval-Induced Forgetting (RIF)** — non-retrieved competitors' stability drops
3. **Involuntary Recall** — small probability of surfacing an unrelated memory
4. **Metacognitive Feeling-of-Knowing (FOK)** — detect tip-of-the-tongue states

Consolidation-time (async):

5. **Temporal Gist** — old verbatim traces compress to gists
6. **Schema Encoding** — schema-congruent traces get encoding-strength boost
7. **Source Confidence Decay** — per-source-type decay multipliers
8. **Emotion Regulation** — reappraisal + suppression for high-intensity traces

HEXACO-modulated at construction time via `applyPersonalityModulation()`.

Flashbulb immunity (hardcoded `encodingStrength ≥ 0.9`): reconsolidation (via config override), RIF, temporal gist, emotion regulation all skip these. `consolidation-signal-preservation` micro-benchmark pins this invariant.

---

## 4. AgentOS RAG infrastructure (`src/rag/`)

Most of this is NOT currently used by the bench — we drive `CognitiveMemoryManager` which has its own 6-signal scorer. This section is a map for future bench extensions.

### 4.1 Chunking

Two distinct chunkers:

**`memory/io/ingestion/ChunkingEngine.ts`** — 4 strategies for document ingestion through the Memory facade:

- `'fixed'` — character-count with word-boundary awareness, configurable overlap
- `'semantic'` — sentence embeddings with cosine-similarity topic-boundary detection (falls back to `fixed` without `embedFn`). Threshold: 0.3.
- `'hierarchical'` — honours Markdown heading structure
- `'layout'` — preserves fenced code blocks + pipe-delimited tables as atomic chunks

Defaults: `chunkSize=512`, `chunkOverlap=64`, `SEMANTIC_SPLIT_THRESHOLD=0.3`, `SEMANTIC_MAX_CHUNK_MULTIPLIER=2`.

**`rag/chunking/SemanticChunker.ts`** — three-tier boundary splitter (heading → paragraph → sentence → fixed fallback) with code-block and heading preservation. Config: `targetSize=1000`, `maxSize=2000`, `minSize=200`, `overlap=100`.

### 4.2 Vector stores (7 backends)

`src/rag/vector_stores/`, all implementing `IVectorStore`:

- `InMemoryVectorStore` — ephemeral, optional file persistence (bench uses this)
- `HnswlibVectorStore` — HNSW index
- `QdrantVectorStore` — Qdrant
- `PineconeVectorStore` — Pinecone
- `PostgresVectorStore` — Postgres + pgvector
- `Neo4jVectorStore` — Neo4j
- `SqlVectorStore` — SQL via `@framers/sql-storage-adapter` (cross-platform)

`VectorStoreManager` (`src/rag/VectorStoreManager.ts`) dispatches provider configs to the right backend.

### 4.3 Embeddings

- `IEmbeddingManager` — contract (`src/core/embeddings/IEmbeddingManager.ts`)
- `EmbeddingManager` — provider-agnostic implementation backed by `AIModelProviderManager`
- `api/embedText.ts` — **first-class provider-agnostic function** for OpenAI / Ollama / OpenRouter / Azure. Accepts `provider:model` or plain model IDs, resolves API keys from env, supports `dimensions` override for `text-embedding-3-*`.

The bench's `OpenAIEmbedder` is a thin 15-line adapter that presents `embedText` as an `IEmbeddingManager` so the cognitive manager can use it.

### 4.4 Retrieval augmentor

`src/rag/RetrievalAugmentor.ts` — full-service RAG pipeline: ingest docs → chunk → embed → store → retrieve. Not currently used by the bench.

### 4.5 Reranker

`src/rag/reranking/` — post-retrieval quality improvement. Primary backend: **Cohere rerank-v3.5**. Fallback: **LLM-Judge**. Blends at 0.7/0.3 with the 6-signal composite score. Enabled via `CognitiveMemoryConfig.rerankerService`.

### 4.6 HyDE retrieval

`src/rag/HydeRetriever.ts` — generates a hypothetical answer with an LLM, embeds THAT, then searches. Multi-hypothesis (default 3 diverse perspectives), adaptive thresholding (starts 0.7, steps down to 0.3). Exposed via `CognitiveRetrievalOptions.hyde: true`. **Not used in the current bench pilot (user excluded it).**

### 4.7 RAPTOR

`src/rag/raptor/RaptorTree.ts` — Recursive Abstractive Processing for Tree-Organized Retrieval (Sarthi et al. 2024). Builds a hierarchical summary tree (layer 0 = leaf chunks, layer N = corpus-level summary), searches all layers simultaneously. Cluster via k-means on embeddings → summarize via LLM → repeat.

### 4.8 GraphRAG

`src/rag/graphrag/GraphRAGEngine.ts` + `Neo4jGraphRAGEngine`. Extracts entities + relations from text, queries via graph traversal + vector similarity fusion. Supports community detection (louvain) and multi-hop reasoning.

---

## 5. GraphRAG + memory graph

### 5.1 `IMemoryGraph`

`src/memory/retrieval/graph/IMemoryGraph.ts`. Two backends:

- **`GraphologyMemoryGraph`** — in-process, `graphology` library, default
- **`KnowledgeGraphMemoryGraph`** — wraps `IKnowledgeGraph` (Sqlite or Neo4j)

### 5.2 Spreading activation

`src/memory/retrieval/graph/SpreadingActivation.ts`. Anderson's ACT-R model, pure function:

```
spreadActivation({ seedIds, getNeighbors, config })
  config:
    maxDepth: 3             BFS cutoff
    decayPerHop: 0.5        weight decay per hop
    activationThreshold: 0.1  minimum to keep
    maxResults: 20
```

Multi-path summation (capped at 1.0). The `spreading-activation-precision` micro-benchmark validates ≥80% cluster containment on synthetic graphs.

### 5.3 Knowledge graph

`IKnowledgeGraph` (`src/memory/retrieval/graph/knowledge/IKnowledgeGraph.ts`). Entities + relations + episodic memories, graph traversal, semantic search, entity merging, decay. Backends: `KnowledgeGraph` (in-memory), `SqliteKnowledgeGraph`, `Neo4jKnowledgeGraph`.

---

## 6. Observability + evaluation (`src/evaluation/`)

Separate from `agentos-bench` — older evaluation framework shipped with AgentOS itself. Has `Evaluator`, `LLMJudge`, `Tracer`, `otel` integration. Not used by the bench (we built our own `BenchmarkRunner` with a different shape), but available for in-app usage.

---

## 7. Pilot spec (for the new session to pick up)

### 7.1 Prereqs

- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` set (available in `apps/wilds-ai/.env.local`; `set -a && source apps/wilds-ai/.env.local && set +a`)
- LongMemEval-S dataset downloaded: `data/longmemeval/longmemeval_s.json` (~278 MB, already present after `agentos-bench setup`)
- Fresh cache: `rm -rf packages/agentos-bench/data/cache` (important — old cache will serve stale retrieval results)

### 7.2 The 3 pilots requested

Three 20-case pilots, all `full-cognitive` + `ingest` (per-turn-pair chunks) + `text-embedding-3-small`:

```bash
# Pilot 1: gpt-4o — apples-to-apples with agentmemory (96.2%) and Mastra (84.2%)
agentos-bench run longmemeval-s --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest --sample 20 \
  --embedder-model openai:text-embedding-3-small --max-usd 3 --concurrency 4

# Pilot 2: gpt-5-mini — apples-to-apples with Mastra (94.87%)
agentos-bench run longmemeval-s --reader gpt-5-mini --judge-model gpt-4o \
  --memory full-cognitive --replay ingest --sample 20 \
  --embedder-model openai:text-embedding-3-small --max-usd 2 --concurrency 4

# Pilot 3: LongMemEval-Oracle — reader ceiling, isolates retrieval from reasoning
agentos-bench run longmemeval-oracle --reader gpt-4o --judge-model gpt-4o \
  --memory none --sample 20 --max-usd 2 --concurrency 4
```

### 7.3 After each run

```bash
# Rescore for accurate $ (versioned model-name fallback now handles this
# automatically, but historical JSONs may need it)
node -e "const {rescoreRunCosts} = require('./dist/core/rescoreRunCosts.js'); ..."

# Export CSVs (per-case + per-evidence-row)
agentos-bench export <run-file.json>

# Regenerate leaderboard
agentos-bench leaderboard --note "..."

# Ship into packages/agentos-bench/results/runs/ and commit
```

### 7.4 Expected outcomes

| Pilot | Expected accuracy (post-chunking-fix) | Expected cost |
|---|---:|---:|
| 1 (gpt-4o) | 55–75% if chunking works as planned; 40–50% if not | $1.40 |
| 2 (gpt-5-mini) | Within ±10% of pilot 1 | $0.15 |
| 3 (Oracle, gpt-4o) | 85%+ (reader ceiling) | $0.10 |

If pilot 3 is high and pilots 1–2 are low → retrieval is the bottleneck (invest in chunking, HyDE, reranker).
If pilot 3 is also low → reader prompting or rubric interpretation (invest in prompt engineering).
If pilots 1 and 2 are both ~40% despite per-turn-pair chunking → deeper architectural issue (investigate: top-K, score-threshold filter, or enable HyDE).

---

## 8. Follow-up work queue (prioritised)

1. **Finish the 3 pilots + commit real numbers** (§7).
2. **Analyze failure modes** in the post-fix CSVs. Look for: retrievedEvidence's top hit irrelevance, judge-reasoning patterns (e.g., "partial answer", "missing detail").
3. **HyDE toggle** — already supported by `CognitiveRetrievalOptions.hyde: true`; expose as CLI flag `--hyde` for A/B comparison.
4. **Reranker integration** — wire Cohere rerank-v3.5 through `CognitiveMemoryConfig.rerankerService`; A/B vs no reranker.
5. **Observe-mode optimisation** — batch embedder calls at the replay layer so 16k round-trips become a few batched calls.
6. **Full 500-case sweep** once a single pilot configuration looks promising (budget ~$35 for gpt-4o full-cognitive + $0.02 embedding).
7. **LOCOMO pilot** — same setup on LOCOMO QA task; competitor numbers are sparse here so we'd set an early baseline.
8. **BEAM adapter** once `vectorize-io/agent-memory-benchmark` publishes the dataset schema.
9. **Production embedder** — `text-embedding-3-large` (3072-dim) may help; batched embedding calls definitely will.

---

## 9. How to resume in a new session

1. **Read this file first**. Everything else is secondary.
2. **Check the status of the background pilot:**
   ```bash
   ls /tmp/pilot-v2-results/runs/  # or pgrep -f "cli.js run longmemeval-s"
   ```
   If runs/*.json exists, pilot 1 completed — rescore + export + inspect.
3. **Read `packages/agentos-bench/results/LEADERBOARD.md`** to see current state.
4. **Read the latest run JSON** in `results/runs/*.json` for per-case detail.
5. **`git log --oneline --grep="agentos-bench" -30`** to see every feature commit.
6. **Reference my memory file** at `~/.claude/projects/-Users-johnn-Documents-git-voice-chat-assistant/memory/project_agentos_bench.md`.

Verification loop anytime:
```bash
cd packages/agentos-bench
pnpm typecheck && pnpm vitest run && pnpm build
```

Expected: typecheck clean, 81/81 tests pass, build emits `dist/cli.js`.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **LongMemEval** | Wu et al. 2024, ICLR 2025. 5 case types (single-session user/assistant, multi-session, temporal, knowledge-update, abstention). Variants: S (500 cases, ~115k tokens), M (~500 sessions), Oracle (evidence-only) |
| **LOCOMO** | Maharana et al. 2024, ACL 2024. 10 conversations × ~300 turns × up to 35 sessions. QA, event-summary, multi-choice tasks |
| **BEAM** | Beyond a Million Tokens, ICLR 2026. Hindsight's preferred benchmark (SOTA 64.1% at 10M-token tier, 58% margin over next-best) |
| **Judge** | GPT-4o by default; parses rubric-composed prompt → binary yes/no |
| **Observer** / **Reflector** | CognitiveMemoryManager pipeline for per-turn observation compression + reflection. No-op without `llmInvoker`. Bench falls back to direct `encode()` |
| **Flashbulb** | Trace with `encodingStrength ≥ 0.9`. Protected from reconsolidation / RIF / temporal gist / emotion regulation |
| **HEXACO** | 6-trait personality model (honesty, emotionality, extraversion, agreeableness, conscientiousness, openness). Modulates encoding weights and working memory capacity |
| **PAD** | Pleasure-Arousal-Dominance mood model |
| **Chunking** | Splitting input into retrieval-sized units. Bench's per-turn-pair is the key fix landed 2026-04-19 |
| **HyDE** | Hypothetical Document Embedding — generate fake answer, embed THAT, then search |
| **RAPTOR** | Recursive Abstractive Processing — hierarchical summary tree for multi-granularity retrieval |
| **GraphRAG** | Graph-augmented RAG — extract entities + relations, traverse graph alongside vector search |

---

_Last updated: 2026-04-19. Latest commit at handoff: `99fe9c98da`._
