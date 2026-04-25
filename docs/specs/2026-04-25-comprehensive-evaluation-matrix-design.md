---
title: Comprehensive Evaluation Matrix — Design (Plan B2)
date: 2026-04-25
scope: 6-architecture × 5-benchmark × 6-metric publication-grade comparison table
methodology_anchor: SOTA_CITED_EVIDENCE_2026-04-25.md, NEXT_SESSION_2026-04-25_HANDOFF_v2_POST_SOTA_RESEARCH.md
estimated_cost: $1800-2600 LLM (honest range after BEAM N=2000-per-tier accounting; revisable to $1300-2100 if BEAM 1M dropped)
estimated_duration: 3 weeks (parallel implementation + sweep)
---

# Comprehensive Evaluation Matrix — Design (Plan B2)

## 1. Goal

Produce a single publication-grade comparison table that:

1. **Iterates aggressively first** to find the best architecture per benchmark (Phase A: 15+ cheap variants × 6 benchmarks)
2. **Then validates winners with the best possible metrics** at full N + bootstrap CI + per-category + cost + latency + tokens + judge FPR + cross-judge
3. Covers every shipping AgentOS architecture plus the lowest-hanging-fruit architectural advances (Anthropic Contextual Retrieval, Mem0-v3-style entity-linking) measured at our shipping reader
4. Anchors every published number in a per-case run JSON at seed=42 for third-party reproduction
5. Defers the single largest implementation (Stage E Hindsight 4-network typed observer) to a v2 publication so v1 ships in 3 weeks

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
| 5 | **Tier 3 + Stage L** (Anthropic Contextual Retrieval `summarized` executor at ingest) | NEW | New `agentos-ext-summarized-memory` package |
| 6 | **Tier 3 + Stage I** (entity-linking hybrid retrieval, Mem0-v3-style ADD-only) | NEW | New `agentos-ext-entity-linking-memory` package |

Plus a reference row:

| # | Reference | Source |
|---|---|---|
| R0 | **Full-context gpt-4o** baseline | LongMemEval paper, Mastra research, BEAM paper |
| Rx | Vendor self-reported (Mem0 v3, Mastra OM, Hindsight, Supermemory, Zep) | Footnoted with judge-harness caveats from SOTA_CITED_EVIDENCE §2-§7 |

Per the agentos-bench-is-benchmarks-only invariant, Stage L + Stage I implementations live in agentos core extension packages, not in the bench. Bench wires them as dispatchers behind `IngestRouter` / `MemoryRouter`.

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
| 4 | BEAM 100K | 2000 (100 conv × 20 q) | 100K tok haystack, 32K reader window | New adapter (was `BeamUnimplementedError`) |
| 5 | BEAM 500K | 2000 | 500K tok haystack, 32K reader window | New adapter |
| 6 | BEAM 1M | 2000 | 1M tok haystack, 32K reader window | New adapter |

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

### Week 1.5 — BEAM adapter

Days 6-8: Implement `packages/agentos-bench/src/benchmarks/beam/` adapter. Wraps the official BEAM repo (`github.com/mohammadtavakoli78/BEAM`) loader. Supports `--tier 100k|500k|1m` flag.

Day 9: Phase A on BEAM 100K with Tier 3 min-cost (~$5 to verify pipeline works end-to-end at frontier accuracy).

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
| Stage L ingest, BEAM × 3 tiers | ~$15 |
| Stage I ingest, LongMemEval-S | ~$50 |
| Stage I ingest, LongMemEval-M | ~$100 |
| Stage I ingest, LOCOMO | ~$100 |
| Stage I ingest, BEAM × 3 tiers | ~$15 |
| **Subtotal ingest (all cached after first run)** | **~$605** |
| Phase A sweeps (~15 variants × 6 benchmarks × ~$1 incl. observer-variant ingest) | ~$90 |
| Phase B LongMemEval-S (6 archs × $13) | ~$78 |
| Phase B LongMemEval-M (6 archs × ~$50) | ~$300 |
| Phase B LOCOMO N=1986 (6 archs × $10) | ~$60 |
| Phase B BEAM 100K (6 archs × N=2000 × ~$0.025/case) | ~$300 |
| Phase B BEAM 500K (6 archs × N=2000 × ~$0.030/case) | ~$360 |
| Phase B BEAM 1M (6 archs × N=2000 × ~$0.040/case) | ~$480 |
| Cross-judge BEAM Phase A (subset N=200 at GPT-4.1-mini judge) | ~$10 |
| Stage G judge FPR probes (5 benchmarks × ~$0.05) | ~$0.25 |
| **Subtotal sweeps** | **~$1909** |
| **Grand total** | **~$2514** |

Phase A gating reduces this if architectures fail signal: each architecture that drops at Phase A saves ~$160-300 in Phase B reader cost across the 6 benchmarks (more on BEAM tiers because N=2000 per tier).

Realistic range: **$1800-2600** depending on:
- Whether all 6 architectures survive Phase A (lower bound = 4 survive)
- Whether reader retrieved-evidence context averages closer to 5K (LME-style) or 32K (BEAM-style) tokens
- Whether we run BEAM 1M at full N=2000 or stratified N=500 (saves $360 across the table)

If $2600 is the wrong order of magnitude for the budget envelope, the cleanest cut is **drop BEAM 1M and run only BEAM 100K + 500K** (saves ~$480 + closes the most discriminating tiers per Markmhendrickson's critique). Revised cost: **$1300-2100**.

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

- Stage E (Hindsight 4-network typed observer) — defer to v2 publication
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
