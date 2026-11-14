# agentos-bench

Open benchmark harness for [`@framers/agentos`](https://github.com/framerslab/agentos) memory primitives. Source-only repository, clone and run via the local CLI; not published to npm.

Covers [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (S, M, Oracle variants), [LOCOMO](https://github.com/snap-research/locomo), [BEAM](https://github.com/vectorize-io/agent-memory-benchmark), and a suite of cognitive-mechanism micro-benchmarks. Every published number ships with a per-cell run JSON at fixed seed, a 95% confidence interval, judge false-positive rate probed per benchmark, and explicit methodology disclosures for every cross-vendor comparison.

## Latest headlines (full N=500; `gpt-4o` and `gpt-5-mini` readers routed per question type)

### LongMemEval-S

| Configuration | Accuracy | $/correct | p50 latency | p95 latency |
|---|---:|---:|---:|---:|
| **Canonical-hybrid + sem-embed + reader router** | **85.6%** | **$0.0090** | **3,558 ms** | **7,264 ms** |
| Tier 3 minimize-cost + sem-embed + reader router (prior) | 84.8% | $0.0410 | ~5,000 ms | 111,535 ms |
| Tier 3 minimize-cost + sem-embed (gpt-4o-only baseline) | 83.2% | $0.0521 | — | — |

**At a matched `gpt-4o` reader the same retrieval scores 84.2%, level with Mastra OM with a gpt-4o actor (84.23%, with gemini-2.5-flash as Mastra's observer and reflector).** The 85.6% headline routes four of the six question types (SSA/SSP/KU/MS) to `gpt-5-mini` and keeps `gpt-4o` on TR/SSU, so it is not a matched-reader comparison. The wider LongMemEval-S frontier across all reader tiers and judge configurations spans 89-96% (Mastra OM at gpt-5-mini 94.87%, MemMachine 93.0%, Hindsight 91.4%, Neutrally 89.4%, agentmemory 96.2%). The adjacent stress-tests recorded on top of the 85.6% configuration all regress (the negative-finding rows in `results/LEADERBOARD.md`), so it is a local optimum for this retrieval and reader-router setup.

### LongMemEval-M (1.5M tokens, 500 sessions per haystack)

| Configuration | Accuracy | $/correct | Avg latency |
|---|---:|---:|---:|
| **🚀 M-tuned + sem-embed + reader router + reader-top-K=5** | **70.2%** | **$0.0078** | **84 sec** (p50 18 sec, p95 745 sec) |
| Same config at top-K=50 (prior, superseded) | 57.6% | $0.0505 | 265 sec |
| M-tuned (CharHash baseline) | 45.4% | $0.1348 | 40 sec |

**Competitive with the strongest published M results in the LongMemEval paper.** Table 3 of [Wu et al., ICLR 2025](https://arxiv.org/abs/2410.10813) reports several GPT-4o configurations: round-level Top-5 at 65.7%, session-level Top-5 at 71.4%, round-level Top-10 at 72.0% (the paper's strongest). AgentOS at 70.2% with reader-Top-K=5 (its reader router sends four of the six question types to `gpt-5-mini`, so this is not a reader-matched comparison) sits between the matched-Top-5 round (65.7%) and session (71.4%) numbers and 1.8 below the paper's overall best (72.0%, Top-10). The closest published external number is AgentBrain's 71.7% from their closed-source SaaS. Among open-source memory libraries with publicly reproducible runs (per-case run JSONs at fixed seed, single-CLI reproduction), AgentOS is the only one on the public record above 65% on M. Every other memory-library vendor (Mem0 94.4% on its managed platform at a top_200 retrieval budget, answerer model and LongMemEval variant not named, per [Mem0's docs](https://docs.mem0.ai/core-concepts/memory-evaluation); Mem0's open-source harness runs S by default; Mastra OM 84.2-94.9%, Hindsight 91.4%, Zep 71.2%, EmergenceMem 86%, Supermemory 81.6-85.2%, MemMachine 93%, Memoria 88.78%, agentmemory 96.2%, Backboard 93.4%, ByteRover 92.8%) publishes only the easier S variant. M's 1.5M-token haystacks exceed every production LLM context window, so vendors with prompt-stuffing or compression-based architectures avoid the variant.

Methodology, per-category breakdowns, and all documented negative architecture findings (stress-tests of adjacent configs that regress) are at [`results/eval-matrix-v1/`](results/eval-matrix-v1/). The validated consumer default classifier is `gpt-5-mini`; two independent Phase B runs confirmed that upgrading to `gpt-4o` classifier costs 12× more per query without lifting accuracy on this benchmark's category mix.

## What ships in agentos

The bench's routing primitives ship in [`@framers/agentos`](https://github.com/framerslab/agentos) under `@framers/agentos/memory-router`: the `MemoryRouter` class, which picks a recall backend per query, and `selectReader`, which maps a question category to a reader tier through a preset table.

```ts
import { selectReader } from '@framers/agentos/memory-router';

selectReader('temporal-reasoning', 'min-cost-best-cat-2026-04-28'); // 'gpt-4o'
selectReader('multi-session', 'min-cost-best-cat-2026-04-28');      // 'gpt-5-mini'
```

## Quickstart — reproduce the 85.6% headline

```bash
git clone https://github.com/framerslab/agentos-bench
cd agentos-bench
pnpm install
pnpm build

# Set OPENAI_API_KEY and COHERE_API_KEY in your environment

# Download the LongMemEval-S dataset into data/longmemeval/longmemeval_s.json
pnpm bench setup --benchmark longmemeval-s

NODE_OPTIONS="--max-old-space-size=8192" pnpm bench run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive --replay ingest \
  --hybrid-retrieval --rerank cohere \
  --embedder-model text-embedding-3-small \
  --reader-router min-cost-best-cat-2026-04-28 \
  --concurrency 5 \
  --bootstrap-resamples 10000 \
  --seed 42
```

Expected wall-clock: ~10-15 min at concurrency 5. Expected cost: ~$3.84 in OpenAI reader and judge fees, plus OpenAI embedding charges and Cohere rerank charges, which the bench does not price.

## Vendor reproduction adapters

Direct apples-to-apples reproductions of vendor-published methods, instrumented with our cost+latency capture and run under our judge harness:

- [`vendors/emergence-simple-fast/`](vendors/emergence-simple-fast/) — wraps [`EmergenceAI/emergence_simple_fast`](https://github.com/EmergenceAI/emergence_simple_fast) (their Simple Fast variant at 79% / 3.59 s median per their published numbers; we measure cost+latency in our harness so it can be compared apples-to-apples to AgentOS rows in the LEADERBOARD).
- (queued) `vendors/mastra-om/` — `@mastra/memory` Observational Memory recipe
- (queued) `vendors/supermemory/` — Supermemory TS SDK
- (queued) `vendors/mem0/` — `@mem0ai/mem0` Python adapter

## Transparency stack

- **Per-cell run JSON at seed 42** — [`results/runs/`](results/runs/), stored with Git LFS (see [Run files](#run-files)).
- **95% confidence interval** computed by resampling per-case scores 10 000 times at seed 42 for every reported aggregate
- **Judge false-positive rate probe** per benchmark — LongMemEval-S 1% [0%, 3%], LongMemEval-M 2% [0%, 5%], LOCOMO 0% [0%, 0%].
- **8 negative architecture findings** documented at [`results/eval-matrix-v1/transparency-notes.md`](results/eval-matrix-v1/transparency-notes.md): Stage L Anthropic Contextual Retrieval, Stage I Mem0-v3-style entity-linking re-rank, Stage H hierarchical retrieval, two-call reader compounded with M-tuned, M-tuned flags compounded on S, all-OM Mastra-architecture clone on S, gpt-4o classifier upgrade, and 7 stress-tested adjacent configurations on the 84.8% baseline.
- **Per-vendor caveats** — every cross-vendor accuracy/cost/latency comparison row footnotes which dimensions are apples-to-apples vs not. Mastra and Supermemory do not publish $/correct or per-case latency, so direct comparisons against them on those axes are unmeasurable until vendor-reproduction adapters land.

## Run files

The run JSON and CSV files under `results/runs/` are stored with [Git LFS](https://git-lfs.com). A clone with Git LFS installed downloads every run file, about 2 GB; a clone with `GIT_LFS_SKIP_SMUDGE=1` (or without Git LFS) holds small pointer files instead.

Fetch one run with Git, skipping the rest:

```bash
git lfs install
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/framerslab/agentos-bench.git
cd agentos-bench
git lfs pull --include "results/runs/2026-04-28T19-06-42-271--longmemeval-s--gpt-4o--full-cognitive--ingest.json"
```

Or download it directly, without Git:

```bash
curl -L -O https://media.githubusercontent.com/media/framerslab/agentos-bench/master/results/runs/2026-04-28T19-06-42-271--longmemeval-s--gpt-4o--full-cognitive--ingest.json
```

That file is the 85.6% LongMemEval-S run (`passedCases` 428 of `totalCases` 500).

Four run files are not published, because their per-case error text holds local build paths. Their pointers stay in the tree and their downloads answer 404. Three are crashed runs (the BEAM 100K and two LongMemEval-S runs below); the fourth is the superseded LongMemEval-M top-K=50 run (57.6%, 288/500) that `results/LEADERBOARD.md` and `results/eval-matrix-v1/comparison-table.md` cite:

- `2026-04-27T02-57-10-370--beam-100k--gpt-4o--full-cognitive--ingest.json`
- `2026-04-28T23-35-11-601--longmemeval-m--gpt-4o--full-cognitive--ingest.json`
- `2026-04-29T02-41-18-648--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- `2026-04-29T02-48-19-633--longmemeval-s--gpt-4o--full-cognitive--ingest.json`

The run files quote questions, conversations and answers from the benchmark datasets, which keep their own licences:

- LongMemEval: MIT, Copyright (c) 2024 Di Wu ([licence](https://github.com/xiaowu0162/LongMemEval/blob/main/LICENSE))
- LOCOMO: CC BY-NC 4.0 ([licence](https://github.com/snap-research/locomo/blob/main/LICENSE.txt)); the LOCOMO run files are for non-commercial use
- BEAM: CC BY-SA 4.0 ([dataset card](https://huggingface.co/datasets/Mohammadta/BEAM)); the BEAM run files are shared under the same licence

## Repository layout

```
src/
  benchmarks/         Benchmark adapters (LongMemEval-S/M/Oracle, LOCOMO, BEAM, micro-bench)
  core/               Shared infrastructure: BenchmarkRunner, judge, cost tracker, cache
  observational-memory/  OM-v10/v11 ingest pipeline
  cognitive/          Embedders + cognitive-memory wiring
  drivers/            --driver gmi: answers through an AgentOS agent (replay proxy, capture)
  memory-router/      Reader router calibration tables (mirror of agentos's MemoryRouter)
  readers/            HTTP reader adapters (OpenAI, Anthropic) + MockReader for tests
docs/                 Blog post and architecture notes
results/
  LEADERBOARD.md            Top-level results table for all benchmarks
  eval-matrix-v1/           v1 publication artifacts (transparency-notes, comparison-table)
  runs/                     Per-cell run JSONs and CSVs (Git LFS)
tests/                Vitest unit + contract tests (~80 tests pinning shipping behavior)
vendors/              Vendor-reproduction adapters (run their methods in our harness)
```

## API reference

The CLI surface is the primary user-facing API; entrypoint at [`src/cli.ts`](src/cli.ts). Programmatic API surfaces:

- `BenchmarkRunner` ([`src/core/BenchmarkRunner.ts`](src/core/BenchmarkRunner.ts)): orchestrates a benchmark run with configurable readers, judge, retrieval, and concurrency.
- `MemoryRouter` and `selectReader` ship in [`@framers/agentos`](https://github.com/framerslab/agentos) (`@framers/agentos/memory-router`) so consumer apps share dispatch logic with the bench.
- Cognitive embedder factory at [`src/cognitive/createCognitiveManager.ts`](src/cognitive/createCognitiveManager.ts).
- Per-benchmark adapters under [`src/benchmarks/`](src/benchmarks/) implement a common runner contract.

Every public entrypoint has TSDoc; type-checked via `pnpm exec tsc --noEmit -p tsconfig.json`.

## Examples

- Reproduce the LongMemEval-S 85.6% headline: see Quickstart above.
- Reproduce the LongMemEval-M 70.2% headline:

  ```bash
  # Download the LongMemEval-M dataset into data/longmemeval/longmemeval_m.json
  pnpm bench setup --benchmark longmemeval-m

  NODE_OPTIONS="--max-old-space-size=8192" pnpm bench run longmemeval-m \
    --reader gpt-4o \
    --memory full-cognitive --replay ingest \
    --hybrid-retrieval --rerank cohere \
    --rerank-candidate-multiplier 5 \
    --hyde \
    --embedder-model text-embedding-3-small \
    --reader-router min-cost-best-cat-2026-04-28 \
    --reader-top-k 5 \
    --concurrency 5 \
    --bootstrap-resamples 10000 \
    --seed 42
  ```
- Vendor reproduction (EmergenceMem Simple Fast): see [`vendors/emergence-simple-fast/README.md`](vendors/emergence-simple-fast/README.md).

## The GMI driver

`--driver gmi` answers each LongMemEval case through an AgentOS agent instead of the bench's own retrieve-then-read path: `agent({ runtime: 'gmi' })` from [`@framers/agentos`](https://github.com/framerslab/agentos), with cognitive memory and the run's recall settings ([`src/drivers/gmiDriver.ts`](src/drivers/gmiDriver.ts)).

```bash
pnpm build
pnpm bench run longmemeval-s --driver gmi --reader gpt-4o-mini \
  --embedder-model text-embedding-3-small --judge-model gpt-4o --budget 1600 --case-ids ids.json

# Hybrid recall, reranked by a cross-encoder in this process at a pinned commit of its repository
pnpm bench run longmemeval-s --driver gmi --reader gpt-4o-mini \
  --embedder-model text-embedding-3-small --judge-model gpt-4o --budget 1600 --case-ids ids.json \
  --recall hybrid --rerank local:cross-encoder/ms-marco-MiniLM-L6-v2@233902d25c440f23af6f7d6e94d2946bac0bee0a
```

How a case runs:

- One agent and one session per case. Each user turn of each haystack session goes through `session.send`, in order. A local replay proxy at the agent's base URL ([`src/drivers/replayProxy.ts`](src/drivers/replayProxy.ts)) answers each of those model requests with the dataset's own assistant turn (`Noted.` when the user turn has none), so the agent files the dataset's conversation and filing spends no reader tokens.
- The session's history is cleared after every haystack session. At the question the reader's context holds no haystack turn: what the model knows of the haystack is what recall puts in the memory block.
- The first user turn of a haystack session is prefixed `(Conversation of <date>)` and the question `(Today is <question date>.)`. An agent files what it hears when it hears it, so the dates travel in the text.
- The question is the one request the proxy forwards to the provider, and only under the case's own key, which carries 128 random bits.

What reaches the provider: an embedding request for every filed line and every turn's query, plus one test embedding as each agent starts; the model list, which the OpenAI provider reads as it starts (the proxy forwards that read); one reader request per case, which offers the model no tool; the judge's request, through the bench's own client as on every run. The agent and its embedder read `OPENAI_API_KEY`. `OPENAI_BASE_URL` may name `https://api.openai.com` or a stub on this machine (`127.0.0.1`, `localhost`, `::1`), with no query or fragment (not even a bare trailing `?` or `#`), and a dry run takes the stub alone: the key, the question and its memory block go to that host, so any other host, and the provider over plain `http`, is refused.

A local reranker (`--rerank local:<model>@<revision>`) downloads its weights from Hugging Face on first use, in a dry run too, and runs in this process; nothing about a memory leaves it. It runs on Transformers.js (`@huggingface/transformers`), which `@framers/agentos` installs as an optional dependency: an install without optional dependencies has no local reranker. Each case's agent loads the model as it starts, and no turn waits for the load. The library bounds each rerank in time and, after failures or timeouts in a row, skips rerank for a while; the turns that file a haystack rerank too, so a pause that begins while a case files can reach its question. A turn's rerank that has not run says why in `memoryRecall.reranker` (`loading` while the model loads, `unavailable`, `timeout`, `error`, `backoff`), and the turn keeps recall's order, so read that field on each case before taking a run as reranked. The models AgentOS lists, with the licence each repository states as [AgentOS's reranking docs](https://github.com/framerslab/agentos/blob/f4b8e7853bedb0879845ca6a24bb26d5f4227260/docs/text/RERANKING.md) give it:

| Model | Licence |
|---|---|
| [`cross-encoder/ms-marco-MiniLM-L6-v2`](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2) (AgentOS's default; its docs pin commit `233902d25c440f23af6f7d6e94d2946bac0bee0a`) | apache-2.0 |
| [`cross-encoder/ms-marco-MiniLM-L12-v2`](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L12-v2) | apache-2.0 |
| [`BAAI/bge-reranker-base`](https://huggingface.co/BAAI/bge-reranker-base) | mit |

What a case's `metadata` holds:

- `memoryRecall`: the turn's recall capture (`memory-recall-capture/1`), with ids, ranks, scores, outcomes, tokens and timings, never a memory's text or the query's.
- `ingest`: haystack sessions, user turns filed, assistant turns replayed, turns skipped, model requests beyond one per filed turn (`extraModelRequests`), and the filing time.
- `upstream` (the endpoint the case's requests went to), `agentosVersion` (the installed `@framers/agentos`), `forwardedRequests`, `modelListReads` and the run's `gmiRecall` settings.

A driver case carries no retrieval score (Recall@K, NDCG, MRR): its recall is recorded in `memoryRecall` by memory id, not as retrieved haystack sessions.

A driver run records the same `memoryMode` and `replayMode` as a bench-path `full-cognitive`/`observe` run, so `results/summary.json` keys its row with the driver appended (`longmemeval-s|gpt-4o|full-cognitive|observe|gmi`) and the entry carries `driver: "gmi"`. The two rows stand side by side: neither replaces the other. `pnpm bench leaderboard` names the driver in the row's System column, `pnpm bench runs` lists it in a `driver` column and the sweep report's cells table in a `Driver` column, and the sweep report's champion and footprint lines name it. The run file's name ends in the driver too (`<started>--longmemeval-s--gpt-4o--full-cognitive--observe--gmi.json`). Rows and run files of the bench's own path keep the names they always had.

The run file's `config` records `gmiUpstream`: scheme, host, port and base path, without credentials. A run built on `BenchmarkRunner` that names its endpoint is recorded in that form too, and a name that carries credentials, a query or a fragment is refused before the run starts. The case-run cache keys a driver run by the driver's version, the installed `@framers/agentos` release, that endpoint and the recall settings, so answers a stub gave never serve a run against the provider or against another stub, and answers one release gave never serve another. A run built on `BenchmarkRunner` without the CLI that names no endpoint is keyed by the one `OPENAI_BASE_URL` gives when it starts. When a run names an endpoint in `gmiUpstream` other than the one `OPENAI_BASE_URL` gives, the run is refused before any case sends anything, and nothing is cached or saved for it: the driver sends where `OPENAI_BASE_URL` points, so the answers would otherwise be recorded and cached under an endpoint that never gave them. A run whose answers the cache already holds in full under the named endpoint sends nothing and is answered from the cache, since that endpoint gave the answers; when the cache holds only some of them, the whole run is refused. Each case sends through a replay proxy for the endpoint and key the environment names when it starts, so a second run in the same process with other values never reaches the first run's upstream. The reader's cost is priced from the provider's usage. The embedding cost is an estimate from the filed text, recorded under the tag `<case id>:gmi-embedding-estimate`.

| Flag | Effect |
|---|---|
| `--driver gmi` | Answer through the agent. The run file records `memoryMode: full-cognitive` and `replayMode: observe`. |
| `--budget <tokens>` | `memory.recall.budget.totalTokens`, the whole memory block a turn sends; 1 or more. Unset: the library default. |
| `--gmi-store memory\|sqlite` | Keep memory in the process (the default) or in one SQLite file per case under the run's scratch directory, removed when the case ends. |
| `--recall dense\|hybrid` | `memory.recall.retrieval`: `dense` finds a turn's memories by meaning; `hybrid` by meaning, by the turn's exact words and by recency, fused into one deduplicated pool. Unset: the library default. The capture records which ran (`memoryRecall.retrieval`) and each leg (`memoryRecall.legs`). |
| `--rerank none\|local:<model>@<revision>` | `memory.recall.rerank`: no reranker, or a cross-encoder in this process, named by its Hugging Face model id and pinned to a whole commit id of its repository in lower case (40 or 64 hexadecimal characters; a branch, a tag or a shortened id can name other weights later). Unset: the library default. |
| `--case-ids <file>` | Run only the listed cases, in the list's order: a JSON array of `question_id` values, or an object with a `tuning` array. An id the dataset lacks fails the run. Works on any LongMemEval run; on the bench's own path the cost preflight counts the listed cases. |

Beside those six, a driver run takes the options that do not belong to the bench's own retrieval and reading: `--reader`, `--embedder-model`, `--judge-model`, `--sample`, `--sample-per-type`, `--stratified`, `--concurrency`, `--seed`, `--bootstrap-resamples`, `--judge-adversarial` and its two settings (not in a dry run, on any path: the probe's synthesizer calls a provider), `--data-dir`, `--results-dir` and `--dry-run`. `--embedder-model` names an OpenAI embedding model (`text-embedding-*`, bare or `openai:`-prefixed); unset, the driver embeds with `text-embedding-3-small`.

The driver refuses, by name:

- every other option of `run` given on the command line (`--hybrid-retrieval`, `--hyde`, `--rerank-model`, `--rerank-candidate-multiplier`, `--reader-top-k`, `--retrieval-k`, `--profile`, `--ablate-mechanism`, `--observational-memory`, `--memory`, `--replay` and the rest), since the agent does its own recall and reading and such an option would have nothing to act on;
- a `--rerank` other than `none` or `local:<model>@<revision>` at a whole commit id: `cohere` and any other remote provider, and an LLM judge, since a driver run sends memory text to no second vendor and measures what can become the library's default;
- a reader router or a reader other than an OpenAI `gpt-*` model, since a run measures one named model;
- an embedder other than an OpenAI `text-embedding-*` model, since the agent embeds through OpenAI's API at the same endpoint;
- `--max-usd`, since the driver has no cost projection yet: bound a run with `--case-ids`;
- a benchmark other than LongMemEval;
- `--budget`, `--gmi-store` and `--recall` without `--driver gmi` (without the driver, `--rerank` is the bench's own Cohere reranker).

A run built on `BenchmarkRunner` without the CLI gets the same checks that hold for the whole run (the embedder, a `gmiUpstream` the environment does not give, `OPENAI_API_KEY`, the endpoint `OPENAI_BASE_URL` names) once, before any case runs, unless the cache answers every case. A refused run throws and writes no run file and no summary row, so it never replaces a driver row with a row of zeros. A case that errors in a run that goes ahead is scored zero, and neither its answer nor its score is cached; a zero cached for an errored case by an earlier release is scored again, so the case's next successful run is judged.

## Development

CI runs the type check, the suite, the build and the built CLI on every ready pull request (`.github/workflows/ci.yml`), against the published `@framers/agentos` named in `package.json`. The lockfile is resolved by the `Lockfile` workflow and committed from its artifact; `package.json` and `pnpm-lock.yaml` change together. The suite needs the BEAM 100k files `queries.json.gz` and `documents.json.gz` under `data/beam/100k/`. CI fetches them from a pinned upstream commit, verifies their sizes and SHA-256 checksums, and caches them. To get the same files locally, run the following from the repository root (the CLI's `setup` command does not yet register BEAM):

```sh
mkdir -p data/beam/100k
beam_source=https://raw.githubusercontent.com/vectorize-io/agent-memory-benchmark/28b644bd4dd653c0207c7507280439390c829155/data/beam/100k
for file in queries.json.gz documents.json.gz; do
  curl --fail --location --retry 3 --output "data/beam/100k/$file" "$beam_source/$file" || exit 1
done
```

The expected sizes are 56,681 and 2,745,433 bytes respectively; the pinned checksums are in [the CI workflow](.github/workflows/ci.yml). BEAM is [CC BY-SA 4.0](https://huggingface.co/datasets/Mohammadta/BEAM/raw/3205395e897e7318c7b094ef4e6047b9b82dbb03/README.md); the dataset files are downloaded for testing and are not redistributed by this repository.

## License

Apache 2.0 — see [LICENSE](LICENSE).
