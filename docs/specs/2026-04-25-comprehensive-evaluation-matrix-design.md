---
title: Comprehensive Evaluation Matrix — Design (Plan B2)
date: 2026-04-25
scope: 6-architecture × 5-benchmark × 6-metric publication-grade comparison table
methodology_anchor: SOTA_CITED_EVIDENCE_2026-04-25.md, NEXT_SESSION_2026-04-25_HANDOFF_v2_POST_SOTA_RESEARCH.md
estimated_cost: ~$400-600 net new LLM (cached prior runs leveraged; Stage L + Stage I dropped after measured negative; full BEAM Phase B deferred to v2 with Stage E)
revision_history:
  - 2026-04-25 v1: spec drafted at $1800-2600 (full BEAM Phase B included)
  - 2026-04-25 v2: BEAM Phase B descoped to spot-check; full multi-tier BEAM deferred to v2 paired with Stage E typed-network observer (saves ~$1100)
  - 2026-04-25 v3: Stage L MEASURED on LongMemEval-S — −3.7pp (temporal-reasoning collapsed −33.3pp). Document-domain Anthropic Contextual Retrieval doesn't translate to conversational memory. Stage L dropped from Phase B sweep. See STAGE_L_PHASE_A_FINDINGS_2026-04-25.md.
  - 2026-04-25 v4: Stage I MEASURED on LOCOMO — −4.0pp (multi-hop −20pp). Mem0-v3-style entity-linking re-rank duplicates Cohere rerank's cross-encoder semantic signal. Stage I dropped from Phase B sweep. See STAGE_I_PHASE_A_FINDINGS_2026-04-25.md. Both architectures shipped in agentos (0.2.12, 0.2.13) as production primitives for IngestRouter / MemoryRouter consumers.
  - 2026-04-25 v5: Stage J unblocked (LongMemEval-M loader streamed via stream-json + stream-chain). First Phase A measurement on M: 41.7% N=12 (-35pp from S baseline; single-session-assistant + temporal-reasoning collapsed to 0%). See STAGE_J_PHASE_A_FINDINGS_2026-04-25.md.
estimated_duration: ~1 week remaining work after measurement updates (Phase B for 4 surviving architectures + Stage G judge FPR + table assembly)
---

# Comprehensive Evaluation Matrix — Design (Plan B2)

## 1. Goal

Produce a single publication-grade comparison table that:

1. **Iterates aggressively first** to find the best architecture per benchmark (Phase A: 15+ cheap variants × 4 benchmarks)
2. **Then validates winners with the best possible metrics** at full N on the conversational benchmarks (LongMemEval-S, LongMemEval-M, LOCOMO) + bootstrap CI + per-category + cost + latency + tokens + judge FPR
3. **Tracks BEAM via spot-check at the 100K tier** (not full multi-tier sweep) so we have an anchor measurement for the v2 publication that pairs Stage E with the full BEAM table
4. Covers every shipping AgentOS architecture plus the lowest-hanging-fruit architectural advances (Anthropic Contextual Retrieval, Mem0-v3-style entity-linking) measured at our shipping reader
5. Anchors every published number in a per-case run JSON at seed=42 for third-party reproduction
6. Defers Stage E Hindsight 4-network typed observer AND full multi-tier BEAM to a v2 publication where they ship together

The brutal-honest reasoning behind the BEAM scope cut: our LOCOMO 51.5% predicts BEAM 10M ~30-45%, and Hindsight ships at 64.1%. Publishing a non-competitive headline number for $1140 of LLM and 5+ days of dev work is anti-leverage. Bundling BEAM with Stage E in v2 produces a publication that says "we built Stage E and went from preliminary 32% to validated 55%", which is worth the spend. Publishing 35% in v1 is not.

Non-goals: cross-vendor reproduction (defer to v2 with Supermemory's `memorybench`), MemoryArena coverage (defer to v3), and any architecture that adds a non-OpenAI dependency for the shipping configuration.

## 2. Methodology — cheap-search → expensive-validation

The bench already supports `--sample-per-type N` for stratified subsets with weighted aggregation + bootstrap CI. The pattern:

| Phase | N | Cost (per arch × benchmark) | Decision |
|---|---:|---:|---|
| **Phase A — architecture search** | 25-50 stratified | $0.10-2 | Run all candidate architectures. Drop architectures whose Phase A point estimate falls outside the 95% bootstrap CI of the current shipping baseline (no signal of improvement). |
| **Phase B — full validation** | 500-1986 (LME), 60 (BEAM × tier) | $10-50 | Only for architectures that survived Phase A. Reports the publishable number with bootstrap 95% CI. |

This is the existing pattern from prior sessions, formalized as a gate. Saves money on architectures that won't ship anyway.

## 3. Architecture matrix (rows)

Six rows. All measured at `gpt-4o` reader, `gpt-4o-2024-08-06` judge, rubric `2026-04-18.1`, seed=42, bootstrap 10k resamples.

| # | Architecture | Status | Implementation needed |
|---|---|---|---|
| 1 | **Tier 1 canonical-hybrid** | Shipping | None |
| 2 | **Tier 2b OM-v11** | Shipping | None |
| 3 | **Tier 3 min-cost** (`@framers/agentos/memory-router` `minimize-cost` preset) | Shipping (current SOTA) | None |
| 4 | **Tier 3 max-acc** (`maximize-accuracy` preset) | Shipping | None |
| ~~5~~ | ~~Tier 3 + Stage L~~ | DROPPED | **MEASURED 2026-04-25: −3.7pp on LongMemEval-S.** Code shipped in agentos 0.2.12 as IngestRouter `summarized` reference executor for consumers. |
| ~~6~~ | ~~Tier 3 + Stage I~~ | DROPPED | **MEASURED 2026-04-25: −4.0pp on LOCOMO.** Code shipped in agentos 0.2.13 as IngestRouter `fact-graph` + MemoryRouter entity-overlap re-rank primitives for consumers. |

Plus a reference row:

| # | Reference | Source |
|---|---|---|
| R0 | **Full-context gpt-4o** baseline | LongMemEval paper, Mastra research, BEAM paper |
| Rx | Vendor self-reported (Mem0 v3, Mastra OM, Hindsight, Supermemory, Zep) | Footnoted with judge-harness caveats from SOTA_CITED_EVIDENCE §2-§7 |

Per the agentos-bench-is-benchmarks-only invariant, Stage L + Stage I executors live in **agentos core**, co-located with the IngestRouter and MemoryRouter strategy IDs they fulfill — NOT in the bench and NOT in `agentos-ext-*` extension packages. Reference executors ship alongside their strategy IDs so the IngestRouter `summarized` and `fact-graph` strategies work out of the box, instead of being empty promises consumers must implement themselves. The `agentos-ext-*` extension pattern is reserved for OPTIONAL output-side concerns (grounding-guard, pii-redaction, code-safety, topicality). Memory and RAG architectures are core. Bench imports them via `@framers/agentos/ingest-router` and `@framers/agentos/memory-router`.

### 3.2 Why core, not extensions (architectural decision)

When this spec was first drafted (v1), Stage L and Stage I executors were placed in two new extension packages (`agentos-ext-summarized-memory`, `agentos-ext-entity-linking-memory`). That violated the stored agentos-bench-is-benchmarks-only invariant, which explicitly says "all memory/RAG/retrieval improvements go in agentos core, not in the bench adapter" — and by extension, not in `agentos-ext-*` packages, which are for output-side guardrails.

The corrected placement (core) is also better for consumers: the IngestRouter ships `summarized`, `fact-graph`, etc. as strategy IDs. Without core executors, those IDs are empty promises — a developer importing `@framers/agentos/ingest-router` gets the strategy ID surface but has to author their own implementation or install yet another package. Reference executors in core close that gap: the strategy IDs work out of the box.

Anthropic Contextual Retrieval (Stage L) is also baseline RAG circa 2026, not an optional feature. Mem0 v3's hybrid+entity-linking (Stage I) is the production architecture for one of the most-used agent memory libraries. Both are core memory concerns; they belong in agentos core alongside HybridRetriever and CognitiveMemoryManager.

### 3.1 Phase A iteration variants (cheap exploration before Phase B commit)

Phase A is where we iterate to find the best architecture per benchmark. The 6 architectures in §3 are the **expected Phase B finalists**. Phase A tests a wider variant grid to narrow down to those finalists.

| Variant family | Variants tested in Phase A | Cost per variant per benchmark |
|---|---|---:|
| K-sweep on Tier 3 min-cost | K ∈ {10, 20, 42, 62, 100} | ~$0.50 (cached embeddings, only reader differs) |
| Stage L observer model | gpt-5-mini, gpt-4o-mini, gpt-5-nano (3 variants) | ~$2 (each variant requires one ingest pass per benchmark) |
| Stage I retrieval signal weight | entity:0.2, entity:0.5, entity:0.8 (3 variants) | ~$1 (entity store cached, only re-rank weights differ) |
| Reader prompt variants (existing flags) | --no-abstention on/off × Tier 3 min-cost | ~$0.50 |
| Cross-stage combinations | Tier 3 + Stage L + Stage I (compound) | ~$2 |

Total Phase A coverage: ~15 variants × 6 benchmarks × ~$1 average = **~$90 for the full iteration sweep**. Adds 1-2 days to week 1 schedule.

Each variant gets a `decisionGate` evaluation: drop if Phase A point estimate's CI overlaps with Tier 3 min-cost baseline; advance to Phase B otherwise. Surviving variants are the 6 finalists in §3 (or fewer, if some don't beat the baseline).

## 4. Benchmark matrix (columns)

Six columns. Three already implemented (LongMemEval-S, LongMemEval-M, LOCOMO via existing bench adapters). Three new (BEAM 100K + 500K + 1M tiers via new adapter).

| # | Benchmark | N | Avg context | Status |
|---|---|---:|---:|---|
| 1 | LongMemEval-S | 500 | ~115K tok | Shipping |
| 2 | LongMemEval-M | 500 | ~1.5M tok | Shipping (loader exists; not yet sweep-tested) |
| 3 | LOCOMO | 1986 | 199-260 turns | Shipping |
| 4 | BEAM 100K spot-check | 100 (5 conv × 20 q stratified) | 100K tok haystack, 32K reader window | New adapter (was `BeamUnimplementedError`); spot-check only, full N=2000 + multi-tier sweep deferred to v2 |

BEAM 10M deferred. Per Markmhendrickson's published critique, "state integrity degrades at 500K to 2M tokens" — the 100K-1M range is more architecturally discriminating than the 10M tier. BEAM 10M reader cost at gpt-4o is ~$200/architecture for marginal extra information.

## 5. Metric matrix (per cell)

Six independent metrics per architecture × benchmark cell:

| # | Metric | What it captures | Computed by |
|---|---|---|---|
| 1 | **Aggregate accuracy ± 95% CI** | Headline number with statistical validity | `bootstrapCi` over per-case judge scores, 10k resamples, seed=42 |
| 2 | **Per-category breakdown** | Architecture diagnostic (where does it win/lose?) | LongMemEval 6-category, LOCOMO 5-category, BEAM 10-ability |
| 3 | **$/correct** | Cost-efficiency at the shipping reader | `totalUsd / passedCases`, full-pipeline (ingest + reader + judge) |
| 4 | **p50 / p95 latency** | Production-relevance | Per-case `durationMs`, percentiles |
| 5 | **Tokens per query** | Context efficiency | Mean `tokensIn + tokensOut` per case |
| 6 | **Judge FPR @ this benchmark** | Stage G probe per benchmark to quantify rubric strictness | Standalone script: synthesize wrong-but-topical answers, measure judge acceptance rate |

Plus a 7th cross-judge column on BEAM only:

| # | Cross-judge metric | Purpose |
|---|---|---|
| 7 | **BEAM aggregate at GPT-4.1-mini judge** (BEAM official rubric) | Direct comparability with Hindsight 64.1% / Honcho 40.6% / RAG 24.9% on the same judge harness. Footnoted with the FPR delta from our gpt-4o-2024-08-06 judge. |

## 6. Implementation milestones (3 weeks)

### Week 1 — Stage L (Anthropic Contextual Retrieval `summarized` executor)

Days 1-2: TDD contract tests for the executor. Tests assert:
- Per-session summary call produces a non-empty 50-100 token string
- Summary is prepended (not appended) to chunk content before embedding
- Same input → same fingerprinted output (deterministic given seed)
- Cost-per-call within ±20% of $0.003 at gpt-5-mini

Days 3-4: Implementation in new `packages/agentos-ext-summarized-memory/` package. Wires as `IngestRouter.dispatcher['summarized']` executor. Uses existing `gpt-5-mini` adapter (no new provider dependency).

Day 5: Phase A sweep on LongMemEval-S (N=25 stratified per type = 150 cases) at ~$2 to validate +signal vs Tier 3 min-cost.

### Week 1.5 — BEAM adapter (build adapter, spot-check only)

Days 6-8: Implement `packages/agentos-bench/src/benchmarks/beam/` adapter. Wraps the official BEAM repo (`github.com/mohammadtavakoli78/BEAM`) loader. Supports `--tier 100k|500k|1m|10m` flag (only 100k exercised in v1).

Day 9: Spot-check on BEAM 100K with Tier 3 min-cost at N=100 stratified (~$5). Goal is verify the adapter works end-to-end and produces a directional preliminary number to cite in v1 transparency note ("BEAM 100K preliminary: ~X%; full multi-tier table forthcoming in v2 with Stage E").

### Week 2 — Stage I (entity-linking hybrid)

Days 10-12: TDD contract tests for the entity-linking ingest executor + the entity-overlap retrieval-rank signal:
- Entity extraction emits proper-nouns + quoted text + compound noun phrases (Mem0 v3 spec)
- Parallel `{collection}_entities` collection writes succeed
- Retrieval ranking incorporates entity-overlap signal alongside semantic + BM25

Days 13-14: Implementation in new `packages/agentos-ext-entity-linking-memory/` package. Wires as a 4th `MemoryRouter` backend ID `entity-linking-hybrid`.

Day 15: Phase A on LOCOMO (N=15 per type, ~$0.50) to validate signal vs Tier 3 baseline.

### Week 2.5 — Cross-judge BEAM measurement

Day 16: Add `--judge gpt-4.1-mini --judge-rubric beam-official` flag to bench. Re-run BEAM 100K Phase A under both judges to publish the FPR delta.

### Week 3 — Phase B sweeps + table assembly

Days 17-19: Run Phase B for every (architecture, benchmark) cell that survived Phase A. Caching means repeat-architectures share embedding/ingest cost.

Days 20-21: Assemble comparison table, draft accompanying transparency notes (per-cell judge FPR, vendor footnotes from SOTA_CITED_EVIDENCE), update LEADERBOARD.md.

## 7. Cost breakdown (estimated)

| Line item | Cost |
|---|---:|
| Stage L ingest, LongMemEval-S | $75 |
| Stage L ingest, LongMemEval-M | ~$200 |
| Stage L ingest, LOCOMO | ~$50 |
| Stage L ingest, BEAM 100K (spot-check only) | ~$5 |
| Stage I ingest, LongMemEval-S | ~$50 |
| Stage I ingest, LongMemEval-M | ~$100 |
| Stage I ingest, LOCOMO | ~$100 |
| Stage I ingest, BEAM 100K (spot-check only) | ~$5 |
| **Subtotal ingest (all cached after first run)** | **~$585** |
| Phase A sweeps (~15 variants × 3 conversational benchmarks × ~$1) | ~$45 |
| Phase B LongMemEval-S (6 archs × $13, 4 already cached → 2 new × $13) | ~$26 |
| Phase B LongMemEval-M (6 archs × ~$50, all new) | ~$300 |
| Phase B LOCOMO N=1986 (6 archs × $10, 2 cached → 4 new × $10) | ~$40 |
| BEAM 100K spot-check (1 architecture × N=100 stratified) | ~$5 |
| Stage G judge FPR probes (3 benchmarks × ~$0.05) | ~$0.15 |
| **Subtotal sweeps** | **~$416** |
| **Grand total NET NEW** | **~$1001** |

**Cached prior runs that appear in the matrix at $0** (from prior $1300 spend):
- LongMemEval-S × 4 architectures (Tier 1 canonical, Tier 2b OM-v11, Tier 3 min-cost, Tier 3 max-acc)
- LOCOMO × 2 architectures (Tier 1 baseline, K=20 tuned)

Phase A gating may reduce this further if architectures fail signal — each architecture dropped at Phase A saves ~$50-100 in net new Phase B cost.

Realistic NET NEW range: **$900-1200** depending on:
- Whether all 6 architectures survive Phase A
- Whether reader retrieved-evidence context averages ~5K tokens (LongMemEval-style)
- Whether we run LongMemEval-M at full N=500 or stratified N=200 (saves ~$120)

The spot-check-BEAM cut means full multi-tier BEAM (100K + 500K + 1M + 10M) gets bundled with Stage E in v2 (~$1140 + $500 Stage E ingest + $400 Stage E reader = ~$2040 v2 budget). Total v1+v2 spend is roughly equivalent to the original full-BEAM-v1 plan, but v2's narrative ("Stage E pushed BEAM 10M from 32% preliminary to 55% validated") is worth meaningfully more than v1's "first non-Hindsight to publish 35%".

## 8. Decision gates

| Gate | Decision | Rule |
|---|---|---|
| Phase A → Phase B per cell | Drop architecture if Phase A point estimate ≤ Tier 3 min-cost CI lower bound | Saves ~$160/dropped architecture |
| Stage L cleared to ship as default? | Yes if Phase B aggregate beats Tier 3 min-cost on ≥2 of 4 LongMemEval categories | Stage L is the lowest-risk advance |
| Stage I cleared to ship? | Yes if Phase B LOCOMO aggregate ≥ 55% with CI lower bound ≥ 51.5% baseline | Aligned with v2 handoff §1.5 success criteria |
| Spec ships? | Spec ships independent of Phase B outcomes | The methodology + table format ship even if no architecture wins |

## 9. Open questions

1. **Stage L observer model**: spec says `gpt-5-mini`. Should we also Phase A at `gpt-4o-mini` and `gpt-5-nano` to find the cheapest observer that retains the lift? (+$5 Phase A, valuable ablation; defer to follow-up if Stage L wins.)
2. **Stage I entity store**: spec says parallel `{collection}_entities` collection. Should this share the existing `IKnowledgeGraph` or live in its own collection? (Architecturally cleaner to use IKnowledgeGraph; faster to ship as separate collection. Lean separate for v1.)
3. **BEAM judge-rubric translation**: BEAM's nugget-based scoring 0/0.5/1 vs our 0/1 binary. Translation: collapse 0.5 → 1.0 for our rubric (charitable judge) and 0.5 → 0 (strict). Publish both columns? (Yes, transparent ablation.)
4. **Cross-vendor reproductions in this scope?**: Hindsight via `vectorize-io/agent-memory-benchmark` is +1-2 days adapter work. Add as a Stage R0+ row with the Gemini-judge caveat? (Defer to v2 to keep this spec single-judge.)
5. **MemoryArena**: not in scope (per §1 non-goals). Per the survey, LoCoMo near-perfect systems drop to 40-60% on MemoryArena. Worth a v2 publication.

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Stage L `summarized` executor doesn't match Anthropic's measured 35% retrieval failure reduction at our scale | Phase A on 150 cases catches this for $2 before any Phase B spend |
| Stage I entity-linking matches Mem0 v3 production (66.9% LOCOMO) but not managed-platform claim (91.6%) | Documented expectation; success criteria is 55%+, not 90% |
| BEAM adapter discovers the `BAAI/bge-small-en-v1.5` embedding requirement is incompatible with our ingest pipeline | Adapter implementation surfaces this in week 1.5; fallback is Cohere embed-v4 with documented divergence |
| LongMemEval-M reader cost exceeds $50/architecture | Switch to N=200 stratified instead of full N=500; still publishable, halves cost |
| Phase B blows past $1700 ceiling | Drop BEAM 1M tier (saves $300); 500K is more discriminating per Markmhendrickson |

## 11. Anchors + dependencies

- Methodology source: [SOTA_CITED_EVIDENCE_2026-04-25.md](../SOTA_CITED_EVIDENCE_2026-04-25.md) §2-§9
- Experiment plan source: [NEXT_SESSION_2026-04-25_HANDOFF_v2_POST_SOTA_RESEARCH.md](../NEXT_SESSION_2026-04-25_HANDOFF_v2_POST_SOTA_RESEARCH.md) §1
- Stage F-2 contract test pattern (the bug-fix that drove the resolveRunConfig discipline): [STAGE_F2_CORRECTION_2026-04-24.md](../STAGE_F2_CORRECTION_2026-04-24.md)
- Hindsight reference: arxiv.org/html/2512.12818v1 (Stage E reference, deferred)
- Mem0 v3 reference: docs.mem0.ai/migration/oss-v2-to-v3 (Stage I architecture source)
- Anthropic Contextual Retrieval reference: platform.claude.com/cookbook/capabilities-contextual-embeddings-guide (Stage L verbatim recipe)
- BEAM reference: github.com/mohammadtavakoli78/BEAM, arxiv.org/html/2510.27246v1
- Penfield LOCOMO audit: github.com/dial481/locomo-audit (judge-FPR methodology source)

## 12. Out of scope (explicitly)

- Stage E (Hindsight 4-network typed observer) — defer to v2 publication, paired with full BEAM
- **Full multi-tier BEAM (100K + 500K + 1M + 10M) at full N** — defer to v2 alongside Stage E. v1 includes BEAM 100K spot-check only (~$5) to anchor v2 with a baseline measurement
- BEAM cross-judge column (charitable + strict scoring under both gpt-4o-2024-08-06 and GPT-4.1-mini) — defer to v2
- MemoryArena adapter — defer to v3
- Cross-vendor replication via Supermemory's `memorybench` — defer to v2
- Bench-side `policyRouter.ts` migration to `@framers/agentos/memory-router` (deferred from prior session, ~$130 cache invalidation; orthogonal to this spec)
- Any architecture requiring Claude or Gemini for the shipping configuration

## 13. Success criteria

This spec is successful if:

1. The comparison table publishes within 4 weeks of approval (3 implementation + 1 buffer)
2. Every cell has a per-case run JSON at seed=42 reproducible by a third party with `pnpm` access
3. At least one of {Stage L, Stage I} ships as a new shipping default after measured Phase B beats Tier 3 min-cost on its target category
4. Total LLM spend ≤ $1700
5. Judge FPR per benchmark publishes alongside the accuracy column for every benchmark in the table
6. Vendor cross-references are footnoted with the SOTA_CITED_EVIDENCE judge-harness caveats so a reader can audit "is this comparing like-for-like?"
