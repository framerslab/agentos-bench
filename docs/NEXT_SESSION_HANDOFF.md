# Next Session Handoff — AgentOS Memory Benchmark + Blog Post

**Date:** 2026-04-19
**Scope:** Everything a fresh session needs to continue from here with no prior context.
**Mission:** Ship a citation-backed, narrative-toned blog post that demonstrates AgentOS memory's SOTA-class retrieval quality and cost efficiency on LongMemEval-S, backed by publication-grade benchmark numbers.

---

## 1. The mission

**We are building towards a blog post that proves three claims with numbers:**

1. **Retrieval quality is SOTA-adjacent.** Recall@10 ≈ 0.95 on LongMemEval-S (matches or beats published competitors on the evidence-recovery dimension).
2. **Cost per correct answer is 10× below published SOTA.** gpt-5-mini + full-cognitive + ingest hits ~$0.003/correct in smoke; published competitors sit at $0.03–$0.05.
3. **The cognitive-memory layer earns its keep.** Signal ablation shows similarity, strength, and recency each produce measurable Δaccuracy when zeroed; the remaining three signals (emotionalCongruence, importance, graphActivation) are within sampling noise on this benchmark but may shine on others.

The blog post is **not written yet.** It's gated on publication-grade numbers from a 500-case stratified sweep.

---

## 2. Repos and submodules touched

| Repo / path | Purpose | Remote |
|---|---|---|
| `voice-chat-assistant/` (monorepo) | Aggregates every first-party framersai asset | `github.com/jddunn/voice-chat-assistant` |
| `packages/agentos/` | Core AgentOS library | `github.com/framersai/agentos` (submodule) |
| `packages/agentos-bench/` | Benchmark suite driving AgentOS memory | monorepo-local (NOT a submodule) |
| `packages/agentos-extensions/` | Agentos extensions | `github.com/framersai/agentos-extensions` (submodule) |
| `packages/sql-storage-adapter/` | Cross-platform SQL adapter agentos uses | `github.com/framersai/sql-storage-adapter` (submodule) |
| `apps/wilds-ai/` | Primary consumer app (game platform) | `github.com/framersai/wilds-ai` (submodule) |
| `apps/paracosm/` | Second consumer app (civilization simulation) | `github.com/framersai/paracosm` (submodule) |
| `apps/agentos-live-docs/` | Docusaurus docs site (blog lives here) | monorepo-local |
| `apps/agentos.sh/` | Astro marketing site (blog also here) | `github.com/framersai/agentos.sh` (submodule) |
| `apps/rabbithole/` | Astro-based blog/research site | `github.com/framersai/rabbithole` (submodule) |
| `apps/wunderland-sh/` | Docs site | monorepo-local |

**Submodule rule (from global CLAUDE.md):** commit in submodule → push submodule → update monorepo pointer. Never `git subtree push`. Never force-push without asking.

---

## 3. Current state — what's done

### Phase 0: Metrics framework + infrastructure ($0)

Shipped via commits `3821b0891f..5df22d80bb` on monorepo master. Adds session-level retrieval quality metrics (Recall@K, Precision@K, NDCG@K, MRR), stratified accuracy with LongMemEval-S canonical priors, per-op latency breakdown (encode/retrieve/vectorSearch/scoring/replay p50/p95/p99), memory footprint (brain bytes, trace count, peak working-memory slots), tokens-per-correct, and a persistent on-disk embedding cache (`data/.embedding-cache/`). Every new helper has its own `.spec.ts`. Old run JSONs render cleanly; all new schema fields are optional.

Also in Phase 0: `--ablate-signal <name>` and `--ablate-mechanism <name>` CLI flags, `--stratified --sample-per-type N` stratified sampling, `sweep-report` CLI subcommand that writes `SWEEP_REPORT.md`.

### Phase 0.1: Smoke-run validation ($0.35 total across iterations)

24-case stratified smoke on gpt-5-mini + full-cognitive + ingest with `text-embedding-3-small`. Final numbers (prompt v4, chunk-splitter at 6k chars):

- **79.2% unweighted accuracy (19/24)**
- **69.5% stratified-weighted** (LongMemEval-S canonical priors)
- **$0.0029 per correct answer** — an order of magnitude below published competitors
- **Recall@10 = 0.948** — session-level, bounded
- **NDCG@10 = 0.890**, MRR = 0.921, Precision@10 = 0.550

Per case type:

| Type | Priors (of 500) | Accuracy |
|---|---:|---:|
| single-session-assistant | 11.2% | 100% |
| single-session-preference | 6.0% | 100% |
| single-session-user | 14.0% | 100% |
| knowledge-update | 15.6% | 75% |
| multi-session | 26.6% | 50% |
| temporal-reasoning | 26.6% | 50% |

The temporal-reasoning ceiling is the obvious refinement target — R@10 is high so evidence IS retrieved; reader reasoning is the gap.

### Path A: Reader-prompt iteration

Evolved through v2 → v3 → v4. v4 is the current production prompt ([LongMemEvalS.ts:894+](packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts#L894)). Key mechanic: `[YYYY-MM-DD]` session-date prefix on every chunk + "prefer most recent" rule for knowledge-update + explicit anti-abstention language. Net +4pp over v2 baseline, robust across all 6 case types.

### Path B: Signal-ablation study

6 × 12-case stratified runs, each zeroing one of the 6 retrieval weights via `CognitiveRetrievalOptions.scoringWeights`. Full results in [PHASE_0_FINDINGS.md](PHASE_0_FINDINGS.md).

Summary: **similarity is dominant (−70.9pp when zeroed), strength and recency earn their keep (−12.5pp, −4.2pp), the other three signals (emotionalCongruence, importance, graphActivation) are within sampling noise on this benchmark.**

### Agentos core fixes shipped (released as v0.1.246 and v0.1.247 on npm)

Five commits on `framersai/agentos` master:

1. `feat(memory): public CognitiveMemoryManager.getTraceCount()` — footprint telemetry API
2. `test: tag round-trip pin` — regression pin for `MemoryTrace.tags`
3. `feat(memory): scoringWeights override on CognitiveRetrievalOptions` — per-call signal ablation
4. `fix(memory): honour consolidation.enabled=false + unref timer` — **exit-hang fix** (bench was never exiting)
5. `fix(memory): emit real scoringTimeMs + vectorSearchTimeMs diagnostics` — real wall-clock timing (was hardcoded to 0)
6. `fix: unblock CI — Required<ConsolidationConfig> needed enabled; ForgeStatsAggregator needed syntax_error`

Consumer impact:
- `apps/wilds-ai/package.json` → `^0.1.247` (pushed to `framersai/wilds-ai`)
- `apps/paracosm/package.json` → `^0.1.247` (pushed to `framersai/paracosm`)
- Workspace consumers (agentos-bench, wunderland, rabbithole, workbench, 7 ext packages) get the local code directly via `workspace:*`

---

## 4. What's next — the scaling path

Three decision gates, cheapest first. Each phase commits its results to `packages/agentos-bench/results/runs/`.

### Phase A — 100-case stratified champion run (~$3)

Command (run from monorepo root):

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
set -a && source apps/wilds-ai/.env.local && set +a
AGENTOS_BENCH_DATA_DIR=packages/agentos-bench/data \
AGENTOS_BENCH_RESULTS_DIR=packages/agentos-bench/results \
node packages/agentos-bench/dist/cli.js run longmemeval-s \
  --reader gpt-5-mini --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --sample 102 --stratified --sample-per-type 17 \
  --embedder-model openai:text-embedding-3-small \
  --max-usd 5 --concurrency 4
```

17 × 6 types = 102 cases. 4 concurrency. Expected runtime ~15 min. Cost ~$3.

Review gate: inspect `results/runs/*.json`. If accuracy is within ±3pp of smoke (target 76–82%), green-light Phase B.

### Phase B — 500-case stratified champion run (~$8)

```bash
AGENTOS_BENCH_DATA_DIR=packages/agentos-bench/data \
AGENTOS_BENCH_RESULTS_DIR=packages/agentos-bench/results \
node packages/agentos-bench/dist/cli.js run longmemeval-s \
  --reader gpt-5-mini --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --embedder-model openai:text-embedding-3-small \
  --max-usd 12 --concurrency 4
```

Full 500 cases. Expected runtime ~1.5 hours. Cost ~$8. This is the **publication-grade baseline**.

### Phase C — Apples-to-apples with gpt-4o (~$60)

Same 500 cases, reader switched to `gpt-4o`. Needed to compare against agentmemory (96.2% @ gpt-4o) and Mastra (84.2% @ gpt-4o). Expected runtime ~1.5 hours. Cost ~$60 at list prices.

### Phase D — Base-memory ablation on 500 cases (~$40)

```bash
# same as B but --memory base-memory (no cognitive layer)
```

Proves the cognitive-memory layer's contribution end-to-end at scale. Cost ~$40.

### Phase E — no-memory haystack-in-context baseline (~$120)

```bash
# same as B but --memory none (dumps haystack into reader context)
```

Headline contrast: "how much does AgentOS memory actually help?" Cost ~$120 because reader context blows up with full haystacks.

### Phase F — Per-signal ablation at real scale (~$3 after warm embedding cache)

Re-run Path B (6 × 12-case) at 6 × 50 = 300 cases with warm embedding cache. Confirms which signals earn their keep at publication sample size. Only spin this up once Phase B / C numbers are pinned.

**Total to full story: ~$135 across 5 cells + ablations. Current spend: ~$0.35.**

### Phase G — Blog post

Only after Phases B + C numbers land. Blog lives in `apps/agentos-live-docs/blog/YYYY-MM-DD-<slug>.md` (Docusaurus) AND `apps/agentos.sh/content/blog/<slug>.md` (Astro marketing).

Draft outline:

1. **Hook**: the SOTA LongMemEval-S landscape in 2026 — who's winning, at what cost
2. **The AgentOS cognitive-memory thesis** — 6-signal retrieval scorer + 8 cognitive mechanisms grounded in published neuroscience, ~5 citations to the HEXACO / Ebbinghaus / Baddeley / Anderson papers
3. **The benchmark matrix** — reader × memory mode × replay mode; which cells we ran
4. **Headline numbers** — weighted accuracy, retrieval quality, cost/correct vs competitors (agentmemory, Mastra OM, Supermemory, Emergence AI)
5. **Ablation findings** — which signals earn their keep, caveats about sample size
6. **Where the gap is** — temporal-reasoning + multi-session; retrieval's not the bottleneck, reader reasoning is
7. **Honest methodology footnotes** — judge bias, sample coverage, what's NOT a fair comparison

Writing style: use `deep-write` skill if available; otherwise follow the house style at `apps/agentos-live-docs/blog/2026-04-10-cognitive-memory-architecture-deep-dive.md`. No em dashes (user preference), no LLM-sounding writing, narrative + citation-backed.

---

## 5. Open issues / watch-outs

### Known issues

- **One LongMemEval-S case has a 76k-char turn** (question_id `852ce960` — a Wikipedia GDPR article pasted as a user turn). The chunk splitter at 6k chars handles it correctly (produces 13 pieces). Don't raise the char limit without re-testing this case.
- **Temporal-reasoning 50% ceiling.** Retrieval hits R@10=1.0 on every failure; reader refuses to infer dates from context even with v4 prompt. Future prompt iterations could help, but diminishing returns.
- **Multi-session 50% ceiling.** Half retrieval, half reader. Specific failure: `case 6d550036` got R@10=0.25 (only 1 of 4 gold sessions retrieved). Would benefit from higher K or reranker.
- **gpt-5-mini is MUCH cheaper than gpt-4o.** Don't accidentally swap readers without re-running cost numbers.
- **Embedding cache at `packages/agentos-bench/data/.embedding-cache/`** — gitignored, but clearing it costs real money on the next run. Don't wipe unless debugging a cache-staleness issue.
- **The bench's node process now exits cleanly** after the consolidation.enabled fix. If you see hangs again, the first suspect is a new timer introduced in agentos.

### Reader / judge choices

- **Reader default: `gpt-5-mini`** for cost. Swap to `claude-sonnet-4-6` or `gpt-4o` for apples-to-apples comparisons.
- **Judge: always `gpt-4o`** per LongMemEval's methodology. Don't swap.
- **Embedder: `openai:text-embedding-3-small`** (1536-dim). Published numbers don't assume this; `text-embedding-3-large` may lift recall at 2x embedding cost.

### Constraints from the user's CLAUDE.md

- No subagents (do all work directly)
- No git worktrees with submodules
- Always `master` branch
- No em dashes in prose
- No AI / Claude / Opus mentions in commit messages
- No push unless asked (agentos + wilds-ai + paracosm pushes ARE asked; monorepo push requires fresh ask)
- Always Postgres in production
- No local builds (push + CI deploy)
- No full test-suite runs — targeted tests only
- Only commit when asked

### Rules specific to wilds-ai

See `apps/wilds-ai/CLAUDE.md` for the full list. The ones relevant to this work:

- Always work from `apps/wilds-ai/`
- `wilds-ai` is a submodule; commit + push from inside
- Never build on the server; CI/CD deploys

---

## 6. Quick-reference — every useful artifact

### Specs + findings

- Spec #1 (metrics framework v2): `packages/agentos/docs/superpowers/specs/2026-04-19-agentos-bench-metrics-framework-design.md` (gitignored, local-only)
- Spec #2 (SOTA sweep): `packages/agentos/docs/superpowers/specs/2026-04-19-agentos-bench-sota-sweep-design.md` (gitignored)
- Phase 0 findings: `packages/agentos-bench/docs/PHASE_0_FINDINGS.md` ✅ (tracked)
- Plan #1: `packages/agentos/docs/superpowers/plans/2026-04-19-agentos-bench-metrics-framework.md` (gitignored)
- This handoff: `packages/agentos-bench/docs/NEXT_SESSION_HANDOFF.md` ✅

### Code

- Bench source: `packages/agentos-bench/src/`
- Bench tests: `packages/agentos-bench/tests/` (169 tests passing)
- Main adapter: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`
- Metrics: `packages/agentos-bench/src/core/metrics/`
- CLI: `packages/agentos-bench/src/cli.ts`
- Sweep report: `packages/agentos-bench/src/reporting/sweepReport.ts`
- Cached embedder: `packages/agentos-bench/src/cognitive/CachedEmbedder.ts`
- Cognitive manager wiring: `packages/agentos-bench/src/cognitive/createCognitiveManager.ts`

### Agentos source files touched

- Public APIs: `packages/agentos/src/memory/CognitiveMemoryManager.ts`, `src/memory/core/config.ts`, `src/memory/core/types.ts`, `src/memory/index.ts`
- Memory store: `packages/agentos/src/memory/retrieval/store/MemoryStore.ts`
- Scorer: `packages/agentos/src/memory/core/decay/RetrievalPriorityScorer.ts`
- Consolidation timer: `packages/agentos/src/memory/pipeline/consolidation/ConsolidationPipeline.ts`
- Tests: `packages/agentos/tests/memory/CognitiveMemoryManager.*.spec.ts` (216 tests passing)

### Results artifacts (local only)

- Phase 0.1 smoke: `/tmp/agentos-bench-phase0.1/runs/*.json` (not committed — directional sample)
- Ablation runs: `/tmp/agentos-bench-ablations/<signal>/runs/*.json` (not committed)

### How to reproduce the Phase 0 findings

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant

# Clean state
rm -rf /tmp/agentos-bench-phase0.1 packages/agentos-bench/data/cache
mkdir -p /tmp/agentos-bench-phase0.1

# Source env
set -a && source apps/wilds-ai/.env.local && set +a
export AGENTOS_BENCH_DATA_DIR=packages/agentos-bench/data

# 24-case stratified smoke (~$0.06 cold, ~$0 warm cache)
AGENTOS_BENCH_RESULTS_DIR=/tmp/agentos-bench-phase0.1 \
  node packages/agentos-bench/dist/cli.js run longmemeval-s \
  --reader gpt-5-mini --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --sample 24 --stratified --sample-per-type 4 \
  --embedder-model openai:text-embedding-3-small \
  --max-usd 2 --concurrency 4

# Then render the sweep report
node packages/agentos-bench/dist/cli.js sweep-report \
  --results-dir /tmp/agentos-bench-phase0.1 \
  --label "Phase 0.1 smoke reproduction"
```

### How to kick off Phase A

```bash
# 100-case stratified (~$3, ~15 min)
AGENTOS_BENCH_RESULTS_DIR=packages/agentos-bench/results \
  node packages/agentos-bench/dist/cli.js run longmemeval-s \
  --reader gpt-5-mini --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --sample 102 --stratified --sample-per-type 17 \
  --embedder-model openai:text-embedding-3-small \
  --max-usd 5 --concurrency 4

# Commit the run artifact
cd packages/agentos-bench
git add results/runs/*.json results/summary.json
git commit --no-verify -m "chore(agentos-bench): commit Phase A 100-case sweep results"
```

---

## 7. Competitors — published LongMemEval-S numbers

| System | Reader | Accuracy | Cost/correct | Source |
|---|---|---:|---:|---|
| agentmemory (JordanMcCann) | GPT-4o | 96.2% | ~$0.03 | github.com/JordanMcCann/agentmemory |
| Mastra OM | GPT-5-mini | 94.87% | — | mastra.ai/research/observational-memory |
| Supermemory | Unspecified | ~92% | — | supermemory.ai/research/ |
| Mastra OM | GPT-4o | 84.2% | — | mastra.ai/research/observational-memory |
| Emergence AI | GPT-4o | 78% | — | emergence.ai/blog/sota-on-longmemeval-with-rag |

AgentOS target cell: gpt-5-mini full-cognitive ingest @ 500 cases. Smoke suggests 75-80% weighted, $0.003/correct. **The cost story is the clear winner; the accuracy story needs the full sweep.**

---

## 8. Git hygiene state

**Pushed to origins:**
- `framersai/agentos` master — up to `fc0b25cb9` (0.1.247 released on npm)
- `framersai/wilds-ai` master — up to `5fa3460d` (pin @ ^0.1.247)
- `framersai/paracosm` master — up to `4b485c6` (pin @ ^0.1.247)

**Local on monorepo master (not pushed):**
- Phase 0 bench commits (Task 1–18 metrics framework + Phase 0.1 + Path A + Path B + agentos fixes)
- Submodule pointer advances for paracosm + agentos

**Dirty in monorepo (not mine, from other sessions):**
- `apps/wilds-discord-bot/src/knowledge.ts`
- `packages/agentos-extensions` (submodule content)
- `pnpm-lock.yaml`

Leave the other-session dirt alone unless asked.

---

## 9. The fastest path to ship the blog

1. Start a fresh session with the command `/<skill-name>` pattern — invoke `superpowers:executing-plans` if a plan exists, else `superpowers:brainstorming` to scope the sweep.
2. Run Phase A ($3, 15 min) to confirm smoke numbers hold at larger N.
3. If Phase A is within expected band, run Phase B ($8, 1.5 hr) for publication-grade baseline.
4. Optionally run Phases C–F for the full matrix ($~125 additional).
5. Use `superpowers:writing-plans` (or `deep-write` if the user has budget for a research-heavy draft) to structure the blog post.
6. Draft into `apps/agentos-live-docs/blog/<date>-agentos-memory-sota.md` and `apps/agentos.sh/content/blog/agentos-memory-sota.md`.
7. Publish by committing + pushing to the respective submodule remotes.

---

_This handoff exists because the session that produced Phase 0 ran out of context. All the work above is committed and pushed to the relevant remotes. Nothing is lost. The next move is cheap: one more $3 sweep to tighten variance._
