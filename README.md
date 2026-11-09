# agentos-bench

Open benchmark harness for [`@framers/agentos`](https://github.com/framerslab/agentos) memory primitives. Source-only repository, clone and run via the local CLI; not published to npm.

Covers [LongMemEval](https://github.com/xiaowu0162/LongMemEval) (S, M, Oracle variants), [LOCOMO](https://github.com/snap-research/locomo), [BEAM](https://github.com/vectorize-io/agent-memory-benchmark), and a suite of cognitive-mechanism micro-benchmarks. Every published number ships with a per-cell run JSON at fixed seed, a 95% confidence interval, judge false-positive rate probed per benchmark, and explicit methodology disclosures for every cross-vendor comparison.

## LongMemEval results

The LongMemEval-S and LongMemEval-M results are being re-run without a remote reranker. This README carries no LongMemEval headline until those runs finish.

Methodology and the documented negative architecture findings are at [`results/eval-matrix-v1/`](results/eval-matrix-v1/).

## What ships in agentos

The bench's routing primitives ship in [`@framers/agentos`](https://github.com/framerslab/agentos) under `@framers/agentos/memory-router`: the `MemoryRouter` class, which picks a recall backend per query, and `selectReader`, which maps a question category to a reader tier through a preset table.

```ts
import { selectReader } from '@framers/agentos/memory-router';

selectReader('temporal-reasoning', 'min-cost-best-cat-2026-04-28'); // 'gpt-4o'
selectReader('multi-session', 'min-cost-best-cat-2026-04-28');      // 'gpt-5-mini'
```

## Quickstart

```bash
git clone https://github.com/framerslab/agentos-bench
cd agentos-bench
pnpm install
pnpm build

# Download the LongMemEval-S dataset into data/longmemeval/longmemeval_s.json
pnpm exec tsx src/cli.ts setup --benchmark longmemeval-s

# List the built-in benchmarks, then see every flag of the run command
pnpm exec tsx src/cli.ts list
pnpm exec tsx src/cli.ts run --help
```

## Vendor reproduction adapters

Direct apples-to-apples reproductions of vendor-published methods, instrumented with our cost+latency capture and run under our judge harness:

- [`vendors/emergence-simple-fast/`](vendors/emergence-simple-fast/) — wraps [`EmergenceAI/emergence_simple_fast`](https://github.com/EmergenceAI/emergence_simple_fast) (their Simple Fast variant at 79% / 3.59 s median per their published numbers; we measure cost+latency in our harness so it can be compared apples-to-apples to AgentOS rows in the LEADERBOARD).
- (queued) `vendors/mastra-om/` — `@mastra/memory` Observational Memory recipe
- (queued) `vendors/supermemory/` — Supermemory TS SDK
- (queued) `vendors/mem0/` — `@mem0ai/mem0` Python adapter

## Transparency stack

- **Per-cell run JSON at seed 42** — [`results/runs/`](results/runs/). LongMemEval-M run JSONs exceed the GitHub 100 MB recommendation and are gitignored; their `--summary.json` siblings are committed.
- **95% confidence interval** computed by resampling per-case scores 10 000 times at seed 42 for every reported aggregate
- **Judge false-positive rate probe** per benchmark — LongMemEval-S 1% [0%, 3%], LongMemEval-M 2% [0%, 5%], LOCOMO 0% [0%, 0%].
- **8 negative architecture findings** documented at [`results/eval-matrix-v1/transparency-notes.md`](results/eval-matrix-v1/transparency-notes.md): Stage L Anthropic Contextual Retrieval, Stage I Mem0-v3-style entity-linking re-rank, Stage H hierarchical retrieval, two-call reader compounded with M-tuned, M-tuned flags compounded on S, all-OM Mastra-architecture clone on S, gpt-4o classifier upgrade, and 7 stress-tested adjacent configurations on the Tier 3 + reader-router configuration.
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
docs/                 Blog post and architecture notes
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
- `MemoryRouter` and `selectReader` ship in [`@framers/agentos`](https://github.com/framerslab/agentos) (`@framers/agentos/memory-router`) so consumer apps share dispatch logic with the bench.
- Cognitive embedder factory at [`src/cognitive/createCognitiveManager.ts`](src/cognitive/createCognitiveManager.ts).
- Per-benchmark adapters under [`src/benchmarks/`](src/benchmarks/) implement a common runner contract.

Every public entrypoint has TSDoc; type-checked via `pnpm exec tsc --noEmit -p tsconfig.json`.

## Examples

- Run a LongMemEval-S sample of 20 cases with full cognitive memory:

  ```bash
  # needs OPENAI_API_KEY for the reader and the judge
  pnpm exec tsx src/cli.ts run longmemeval-s \
    --reader gpt-4o \
    --memory full-cognitive --replay ingest \
    --sample 20
  ```
- Vendor reproduction (EmergenceMem Simple Fast): see [`vendors/emergence-simple-fast/README.md`](vendors/emergence-simple-fast/README.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).
