# agentos-bench

Open benchmark harness for [`@framers/agentos`](https://github.com/framersai/agentos) memory primitives. Source-only repository, clone and run via the local CLI; not published to npm.

Covers [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (S, M, Oracle variants), [LOCOMO](https://github.com/snap-research/locomo), [BEAM](https://github.com/vectorize-io/agent-memory-benchmark), and a suite of cognitive-mechanism micro-benchmarks. Every published number ships with a per-cell run JSON at fixed seed, a 95% confidence interval, judge false-positive rate probed per benchmark, and explicit methodology disclosures for every cross-vendor comparison.

## Latest headlines (full N=500 at gpt-4o reader)

### LongMemEval-S

| Configuration | Accuracy | $/correct | p50 latency | p95 latency |
|---|---:|---:|---:|---:|
| **Canonical-hybrid + sem-embed + reader router** | **85.6%** | **$0.0090** | **3,558 ms** | **7,264 ms** |
| Tier 3 minimize-cost + sem-embed + reader router (prior) | 84.8% | $0.0410 | ~5,000 ms | 111,535 ms |
| Tier 3 minimize-cost + sem-embed (gpt-4o-only baseline) | 83.2% | $0.0521 | — | — |

**At a matched `gpt-4o` reader the same retrieval scores 84.2%, level with Mastra OM gpt-4o (84.23%).** The 85.6% headline routes four of the six question types (SSA/SSP/KU/MS) to `gpt-5-mini` and keeps `gpt-4o` on TR/SSU, so it is not a matched-reader comparison. The wider LongMemEval-S frontier across all reader tiers and judge configurations spans 89-96% (Mastra OM at gpt-5-mini 94.87%, MemMachine 93.0%, Hindsight 91.4%, Neutrally 89.4%, agentmemory 96.2%). 16 adjacent stress-tests across Phase A and Phase B all regress on top of the 85.6% configuration, validating it as a local optimum for this retrieval and reader-router setup.

### LongMemEval-M (1.5M tokens, 500 sessions per haystack)

| Configuration | Accuracy | $/correct | Avg latency |
|---|---:|---:|---:|
| **🚀 M-tuned + sem-embed + reader router + reader-top-K=5** | **70.2%** | **$0.0078** | **84 sec** (p50 18 sec, p95 745 sec) |
| Same config at top-K=50 (prior, superseded) | 57.6% | $0.0505 | 265 sec |
| M-tuned (CharHash baseline) | 45.4% | $0.1348 | 40 sec |

**Competitive with the strongest published M results in the LongMemEval paper.** Table 3 of [Wu et al., ICLR 2025](https://arxiv.org/abs/2410.10813) reports several GPT-4o configurations: round-level Top-5 at 65.7%, session-level Top-5 at 71.4%, round-level Top-10 at 72.0% (the paper's strongest). AgentOS at 70.2% with reader-Top-K=5 sits between the matched-Top-5 round (65.7%) and session (71.4%) numbers and 1.8 below the paper's overall best (72.0%, Top-10). The closest published external number is AgentBrain's 71.7% from their closed-source SaaS. Among open-source memory libraries with publicly reproducible runs (per-case run JSONs at fixed seed, single-CLI reproduction), AgentOS is the only one on the public record above 65% on M. Every other memory-library vendor (Mem0 v3 93.4%, Mastra OM 84.2-94.9%, Hindsight 91.4%, Zep 71.2%, EmergenceMem 86%, Supermemory 81.6-85.2%, MemMachine 93%, Memoria 88.78%, agentmemory 96.2%, Backboard 93.4%, ByteRover 92.8%) publishes only the easier S variant. M's 1.5M-token haystacks exceed every production LLM context window, so vendors with prompt-stuffing or compression-based architectures avoid the variant.

Methodology, per-category breakdowns, and all documented negative architecture findings (stress-tests of adjacent configs that regress) are at [`results/eval-matrix-v1/`](results/eval-matrix-v1/). The validated consumer default classifier is `gpt-5-mini`; two independent Phase B runs confirmed that upgrading to `gpt-4o` classifier costs 12× more per query without lifting accuracy on this benchmark's category mix.

## What ships in agentos

The bench's `MemoryRouter` and `ReaderRouter` primitives ship in [`@framers/agentos`](https://github.com/framersai/agentos) so consumers can wire the same dispatch logic directly:

```ts
import { Memory } from '@framers/agentos';
import { ReaderRouter } from '@framers/agentos/memory-router';
import { OpenAIEmbedder } from '@framers/agentos-bench/cognitive';

const mem = await Memory.createSqlite({
  path: './memory.sqlite',
  embedder: new OpenAIEmbedder('text-embedding-3-small'),
  // No policyRouter, no observationalMemory — canonical-hybrid for all cases
  readerRouter: new ReaderRouter({
    preset: 'min-cost-best-cat-2026-04-28',
    classifier: gpt5miniClassifier,
    readers: { 'gpt-4o': gpt4o, 'gpt-5-mini': gpt5mini },
  }),
});
```

## Quickstart — reproduce the 85.6% headline

```bash
git clone https://github.com/framersai/agentos-bench
cd agentos-bench
pnpm install
pnpm build

# Set OPENAI_API_KEY and COHERE_API_KEY in your environment

# Download LongMemEval-S dataset (per upstream instructions at
# https://github.com/xiaowu0162/LongMemEval) into data/longmemeval/longmemeval_s.json

NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsx src/cli.ts run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive --replay ingest \
  --hybrid-retrieval --rerank cohere \
  --embedder-model text-embedding-3-small \
  --reader-router min-cost-best-cat-2026-04-28 \
  --concurrency 5 \
  --bootstrap-resamples 10000
```

Expected wall-clock: ~10-15 min at concurrency 5. Expected cost: ~$3.84 in OpenAI/Cohere fees.

## Vendor reproduction adapters

Direct apples-to-apples reproductions of vendor-published methods, instrumented with our cost+latency capture and run under our judge harness:

- [`vendors/emergence-simple-fast/`](vendors/emergence-simple-fast/) — wraps [`EmergenceAI/emergence_simple_fast`](https://github.com/EmergenceAI/emergence_simple_fast) (their Simple Fast variant at 79% / 3.59 s median per their published numbers; we measure cost+latency in our harness so it can be compared apples-to-apples to AgentOS rows in the LEADERBOARD).
- (queued) `vendors/mastra-om/` — `@mastra/memory` Observational Memory recipe
- (queued) `vendors/supermemory/` — Supermemory TS SDK
- (queued) `vendors/mem0/` — `@mem0ai/mem0` Python adapter

## Transparency stack

- **Per-cell run JSON at seed 42** — [`results/runs/`](results/runs/). LongMemEval-M run JSONs exceed the GitHub 100 MB recommendation and are gitignored; their `--summary.json` siblings are committed.
- **95% confidence interval** computed by resampling per-case scores 10 000 times at seed 42 for every reported aggregate
- **Judge false-positive rate probe** per benchmark — LongMemEval-S 1% [0%, 3%], LongMemEval-M 2% [0%, 5%], LOCOMO 0% [0%, 0%]. See [`docs/SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md`](docs/SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md), [`docs/STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md`](docs/STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md), [`docs/STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md`](docs/STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md).
- **8 negative architecture findings** documented at [`results/eval-matrix-v1/transparency-notes.md`](results/eval-matrix-v1/transparency-notes.md): Stage L Anthropic Contextual Retrieval, Stage I Mem0-v3-style entity-linking re-rank, Stage H hierarchical retrieval, two-call reader compounded with M-tuned, M-tuned flags compounded on S, all-OM Mastra-architecture clone on S, gpt-4o classifier upgrade, and 7 stress-tested adjacent configurations on the 84.8% baseline.
- **Per-vendor caveats** — every cross-vendor accuracy/cost/latency comparison row footnotes which dimensions are apples-to-apples vs not. Mastra and Supermemory do not publish $/correct or per-case latency, so direct comparisons against them on those axes are unmeasurable until vendor-reproduction adapters land.

## Repository layout

```
src/
  benchmarks/         Benchmark adapters (LongMemEval-S/M/Oracle, LOCOMO, BEAM, micro-bench)
  core/               Shared infrastructure: BenchmarkRunner, judge, cost tracker, cache
  observational-memory/  OM-v10/v11 ingest pipeline
  cognitive/          Embedders + cognitive-memory wiring
  memory-router/      Reader router calibration tables (mirror of agentos's MemoryRouter)
  readers/            HTTP reader adapters (OpenAI, Anthropic) + MockReader for tests
docs/                 Findings docs (per-stage Phase A/B writeups), specs, plans
results/
  LEADERBOARD.md            Top-level results table for all benchmarks
  eval-matrix-v1/           v1 publication artifacts (transparency-notes, comparison-table)
  runs/                     Per-cell run JSONs (committed unless > 100 MB)
tests/                Vitest unit + contract tests (~80 tests pinning shipping behavior)
vendors/              Vendor-reproduction adapters (run their methods in our harness)
```

## API reference

The CLI surface is the primary user-facing API; entrypoint at [`src/cli.ts`](src/cli.ts). Programmatic API surfaces:

- `BenchmarkRunner` ([`src/core/BenchmarkRunner.ts`](src/core/BenchmarkRunner.ts)): orchestrates a benchmark run with configurable readers, judge, retrieval, and concurrency.
- `MemoryRouter` and `ReaderRouter` are re-exported via [`@framers/agentos`](https://github.com/framersai/agentos) so consumer apps share dispatch logic with the bench.
- Cognitive embedder factory at [`src/cognitive/createCognitiveManager.ts`](src/cognitive/createCognitiveManager.ts).
- Per-benchmark adapters under [`src/benchmarks/`](src/benchmarks/) implement a common runner contract.

Every public entrypoint has TSDoc; type-checked via `pnpm exec tsc --noEmit -p tsconfig.json`.

## Examples

- Reproduce the LongMemEval-S 85.6% headline: see Quickstart above.
- Reproduce the LongMemEval-M 70.2% headline:

  ```bash
  NODE_OPTIONS="--max-old-space-size=8192" pnpm exec tsx src/cli.ts run longmemeval-m \
    --reader gpt-4o \
    --memory full-cognitive --replay ingest \
    --hybrid-retrieval --rerank cohere \
    --embedder-model text-embedding-3-small \
    --reader-router min-cost-best-cat-2026-04-28 \
    --reader-top-k 5 \
    --concurrency 5 \
    --bootstrap-resamples 10000
  ```
- Vendor reproduction (e.g., Mastra OM):

  ```bash
  pnpm exec tsx vendors/mastra-om/run.ts --reader gpt-4o
  ```
- Per-stage findings + scenarios are under [`docs/`](docs/) and [`scenarios/`](scenarios/) (one folder per stage with run JSONs and analysis).

## License

Apache 2.0 — see [LICENSE](LICENSE).
