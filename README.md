# @framers/agentos-bench

Open benchmark harness for [`@framers/agentos`](https://github.com/framersai/agentos) memory primitives.

Currently covers [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (S, M, Oracle variants), [LOCOMO](https://github.com/snap-research/locomo), [BEAM](https://github.com/vectorize-io/agent-memory-benchmark), and a suite of cognitive-mechanism micro-benchmarks. Every published number ships with: a per-cell run JSON at fixed seed, bootstrap 95% CI at 10 000 resamples, judge false-positive rate probed per benchmark, and explicit methodology disclosures for every cross-vendor comparison.

## Latest headline (LongMemEval-S Phase B N=500, gpt-4o reader)

| Configuration | Accuracy | $/correct | p50 latency | p95 latency |
|---|---:|---:|---:|---:|
| **Tier 3 canonical-hybrid + sem-embed + reader router (NEW 2026-04-28)** | **85.6% [82.4%, 87.8%]** | **$0.0090** | **3,558 ms** | **7,264 ms** |
| Tier 3 minimize-cost + sem-embed + reader router (Pareto-2) | 84.8% [81.6%, 87.8%] | $0.0410 | ~5,000 ms | 111,535 ms |
| Tier 3 minimize-cost + sem-embed (gpt-4o-only baseline) | 83.2% [79.8%, 86.4%] | $0.0521 | — | — |

For an open-source library at `gpt-4o` reader, **85.6%** is competitive with managed-platform-class numbers. Methodology, per-category breakdowns, and 10+ documented negative architecture findings (stress-tests of adjacent configs that all regress) are at [`results/eval-matrix-v1/`](results/eval-matrix-v1/). The validated consumer default classifier is `gpt-5-mini`; two independent Phase B runs confirmed that upgrading to `gpt-4o` classifier costs 12× more per query without lifting accuracy on this benchmark's category mix.

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
- **Bootstrap 95% CI** at 10 000 Mulberry32 resamples for every reported aggregate
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

## License

Apache 2.0 — see [LICENSE](LICENSE).
