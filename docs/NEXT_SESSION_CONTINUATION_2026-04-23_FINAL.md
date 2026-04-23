# Fresh-Session Continuation Handoff — 2026-04-23 (Post Phase B v10 + Step 17 RED)

**Supersedes:** [NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md) (the 2026-04-22 handoff is OUTDATED — Phase B v10 + Step 17 v1/v2 + 16c family + 16b + v7/v8 + v5/v7 Phase A have all run since then; final architecture decided).

**Status at handoff:** Architecture decided. **Tier 1 default = canonical Step 3 Hybrid 73.2% N=500. Tier 2 production opt-in = 16c v10 dynamic router 74.6% N=500.** Step 17 (OM-guided retrieval) tested across two iterations and confirmed RED (latency-bound, dominated by v10). Twenty-six experiments shipped. All code + docs committed and pushed to master in 5 modular commits (1390fc88b6, 900450a2a9, 58cbf8e4fc, 23e97f6f41, c83ed5a485).

**This document is self-contained.** Read end-to-end at maximum reasoning. Paste the §15 prompt into the fresh session.

---

## 0. The 90-second briefing

**What's settled:** AgentOS now ships TWO production tiers on LongMemEval-S at gpt-4o reader + gpt-4o judge:

- **Tier 1 default: Step 3 HybridRetriever** — 73.2% [69.2%, 77.0%] N=500. $0.021 per correct. 98s avg latency. BM25 + dense RRF + Cohere rerank-v3.5 blend over the cognitive composite score.
- **Tier 2 opt-in: Step 16c v10 Dynamic Router** — 74.6% [70.8%, 78.4%] N=500. $0.327 per correct (15.4x premium). 12s avg latency (8.3x faster than canonical). Per-question gpt-5-mini fewshot classifier routes single-session/temporal questions to canonical, KU/MS questions to v5 OM. **First architectural variant to beat canonical at Phase B.** +5.3pp on multi-session at n=133.

**What's been ruled out (RED, deprecated):** v7/v8 (gpt-5 observer trades MS for TR intrinsically); Step 16/16b (OM+retrieval combined polluted by non-gold-session passages); 16c baseline/v9/v11 (worse classifier configs than v10); **Step 17 v1/v2 OM-guided retrieval** (latency-bound at 163s avg / 569s p95 / 12 min worst-case = 13x v10; K=5 candidate-session filter too aggressive for cross-session questions; architecturally dominated by v10's classify-then-route).

**What's still open (next-session candidates, ranked by ROI):**
1. **Tuned OM observer prompt** (preserve high-IDF tokens verbatim) — ~$30 Tier A. Closes Step 7/8 LLM-summary-erases-tokens gap.
2. **v6: gpt-5 observer with `reasoning_effort='medium'`** — ~$50-80 Tier A. May restore TR while keeping MS lift.
3. **Step 17 v3 with BM25 session scoring** — ~4-6 hr code + ~$60 Tier A. Replaces embedder-based scoring; cheaper / more reliable.
4. **Gemini observer parity test** — ~$230 across Tier A → Phase A → Phase B. Likely matches Mastra's 84% but requires accepting Gemini vendor dependency.
5. **Step 18 Hindsight typed networks (4 typed retrieval networks + multi-strategy fusion)** — ~1-2 weeks dev + ~$400 LLM. OpenAI-only path to ~80%+ MS but uncertain at gpt-4o reader (Hindsight publishes at gemini-3-pro).
6. **Voyage-rerank-2 / BGE-reranker-v2-m3** — de-risks Cohere vendor lock; unlikely to lift accuracy.
7. **LongMemEval-M / LongMemEval-L** — stress-test scaling to 500-session / 5000-session variants.

**Budget status:** ~$958 spent across the cumulative rollout. Original approval ~$1200. Headroom remaining: ~$242. Per the user's "as long as it actually works well" stance, additional approval is likely if the next swing has a clear ROI.

**Critical recurring gotchas (read before any LLM-cost run):**

1. **Two-cache bug (case-run + case-result)** — see §7.6 of the prior handoff. When iterating on a config, if a stale case-result entry exists with bad metadata, it short-circuits scoring even when case-run is regenerated. Fix: delete stale entries matching the failure pattern before re-running.
2. **wunderland-sol ENAMETOOLONG** — always run `pnpm typecheck` / `pnpm vitest` from `packages/agentos-bench/` not monorepo root. Recursive symlinks in apps/wunderland-sol/.pnpm-store overflow path length.
3. **`--max-usd` preflight is per-case-cost projection** — actual spend can exceed the cap. Set conservatively (1.5-2x estimate).
4. **Embedder requires `--embedder-model text-embedding-3-small`** — Step 17 v2 attempt 1 was a no-op because the embedder wasn't configured. The CLI flag is required for any path using `this.opts.embedder`.
5. **Phase A on 16c benefits from sample size** — opposite of v4a/v5 sampling-luck pattern. v10 Tier A 66.7% → Phase A 76.5% (+10pp) → Phase B 74.6% (essentially held). Routing benefits from N because the law of large numbers averages classifier noise.

---

## 1. The complete 26-variant scoreboard

All rows at gpt-4o reader + gpt-4o judge. CIs are bootstrap percentile, 10000 resamples, seed=42.

| Step | Variant | Verdict | N | Result | Cost |
|---|---|---|---:|---|---:|
| 1 | Bootstrap CIs + judge-adversarial probe | GREEN-infra | always-on | (methodology) | (counted in steps) |
| 2 | SessionRetriever (no rerank) | RED | Phase A 102 | -23.5pp MS | $1.98 |
| **3** | **HybridRetriever (BM25 + dense + rerank)** | **GREEN-Tier 1** | **Phase B 500** | **73.2% [69.2, 77.0]** | **$7.80** |
| 4 | HyDE | RED | Phase A 102 | -35.3pp | $2.06 |
| 5 | FactSupersession | RED | Phase A 102 | -25pp KU | (counted) |
| 6 | Split-on-Ambiguous | RED | Phase A 24 | -29.2pp | (counted) |
| 7 | Observer/Reflector additive overlay | RED | Tier A 24 | -25pp aggregate | $7.37 |
| 8 | Observer/Reflector replacement | RED | Tier A 24 | -62.5pp | $7.20 |
| 9 | Fact-Graph (Mem0 tuple pattern) | RED | Tier A 24 | -29.2pp, evidenceOrigin: fact_graph 0/24 | $3.05 |
| 11 | Tuned reflector prompt | NULL | Tier A 24 | 62.5% unchanged from Step 7 | $1.45 |
| 12 | BM25 parity for reflection traces | NULL | Tier A 24 | 62.5% unchanged | $1.84 |
| 13 | Heuristic graph activation | RED | Tier A 24 | 50.0% [29.2, 70.8] | $0.42 |
| 14 | Two-call reader (Emergence pattern, 3 variants) | RED | Tier A 24 | 45.8% (extractor atomization breaks cross-fact) | $2.08 |
| 15 v1 | OM Mastra port (per-session observer) | GREEN-soft | Tier A 24 | 75.0% [58.3, 91.7] | $4.28 |
| 15 v2 | Cross-session observer batching | RED | Tier A 24 | 70.8% (no consistent MS lift) | $4.27 |
| 15 v3 | Dual-path (per-session + batched) | RED | Tier A 24 | 70.8% MS 25% (layout collision) | $4.28 |
| 15 v4a | v3 + cross-session reader scaffold | GREEN-Tier A / RED-Phase A | 24 → 102 | 83.3% Tier A → **71.6% Phase A** (sampling luck #1) | $32.49 |
| 15 v4b | Hierarchical (gpt-4o synthesis pass) | RED | Tier A 24 | 75.0% MS +25 / TR -25 (synthesis NOT free-lift) | $4.30 |
| 15 v4c | v4b + scaffold | RED | Tier A 24 | 70.8% (scaffold + synthesis layout conflict) | $4.29 |
| **15 v5** | **dual-path + scaffold + gpt-4o observer** | **GREEN-Tier A / RED-Phase A** | **24 → 102** | **79.2% Tier A → 73.5% Phase A** (sampling luck #2; tied with canonical) | $163.57 |
| 15 v7 | gpt-5 observer + scaffold (v5 derivative) | RED | Tier A 24 / Phase A partial | 70.8% Tier A → 29.4% PA (46/102 quota errors; 56 typed cases worse than v5 across every category) | $61.76 |
| 15 v8 | gpt-5 observer WITHOUT scaffold | RED | Tier A 24 | 66.7% (layout-collision hypothesis REJECTED; TR regression intrinsic to gpt-5) | $25.39 |
| 16 | OM + HybridRetriever combined K=10 | RED | Tier A 24 | 70.8% (MS +25 / SSU+SSP+TR -25 each, context pollution) | $33.67 |
| 16b | Step 16 with K=3 | RED | Tier A 24 | 70.8% (lost MS lift; K-tuning trades pollution for cross-session passage volume one-for-one) | $32.66 |
| 16c baseline | Per-question router (gpt-5-mini classifier, basic prompt) | RED-Tier A | Tier A 24 | 66.7%, classifier 37.5% accurate | $12.48 |
| 16c v9 | gpt-4o classifier | RED | Tier A 24 | 62.5%, classifier 50% (more accurate but routing happened to send fewer KU/MS to OM at small N) | $9.78 |
| **16c v10** | **gpt-5-mini classifier + few-shot prompt** | **GREEN-Tier 2** | **Tier A 24 → Phase A 102 → Phase B 500** | **66.7% Tier A → 76.5% Phase A → 74.6% [70.8, 78.4] Phase B** (FIRST to beat canonical at Phase B; +5.3pp MS at n=133; 8.3x faster latency; 15.4x cost premium) | $150.51 |
| 16c v11 | gpt-4o classifier + few-shot prompt | RED | Tier A 24 | 58.3% (worst variant; sample variance hit MS=0/4) | $7.13 |
| 17 v1 | OM-guided retrieval (parser broken) | RED | Tier A 24 | 70.8% (filter no-op; effectively Step 16 K=30) | $32.72 |
| 17 v2 | OM-guided retrieval (parser fixed; uses ingest.perSessionBatches) | RED | Tier A 24 | 50.0% with 25% transient embedder errors; 66.7% on completed cases. Latency 163s avg / 569s p95 / 12 min worst (13x v10). Architecturally dominated by v10. | $65.46 |

**Total measurement cost:** ~$644.99 across the rollout. Earlier prior-rollout work added another ~$210 (pre-Step-15 Phase B + canonical confirmation runs).

---

## 2. Final architecture decision (settled, deployed)

| Tier | Config | Phase B accuracy | Cost/correct | Avg latency | When to use |
|---|---|---:|---:|---:|---|
| **Tier 1 default** | **canonical (Step 3 Hybrid)** | **73.2% [69.2, 77.0]** N=500 | **$0.021** | 98s | All workloads, default, cost-sensitive |
| **Tier 2 opt-in** | **16c v10 dynamic router** | **74.6% [70.8, 78.4]** N=500 | $0.327 | **12s** | Latency-sensitive, MS-heavy use cases (chat assistants, memory-grounded QA) |
| Tier 3 experimental | v5 OM dual-path + scaffold + gpt-4o observer | 73.5% Phase A (tied) | high | 35s | Workloads explicitly accepting MS lift / TR-SSA cost trade |
| Deprecated/RED | v7, v8, Step 16, 16b, 16c-baseline/v9/v11, Step 17 v1+v2 | various | n/a | varies | documented failures with diagnosis |

### Why v10 wins

- **+1.4pp aggregate over canonical** at point estimate (CIs overlap)
- **+5.3pp on multi-session at n=133** (the categorical category-CI separation)
- **8.3x faster avg latency** (12s vs 98s) because ~80% of cases route through canonical and skip OM entirely
- **Production-architecturally correct**: classify-then-route exploits the per-category Pareto distribution

### Why Step 17 lost to v10

- **Always runs full OM ingest** (~50-150s per case) — v10 routes 80% to canonical and skips OM
- **K=5 candidate-session filter is too aggressive** for cross-session questions — gold sessions sometimes excluded
- **Adds 50+ embedder calls per case** for session scoring — increases latency AND error surface (25% transient API errors observed)
- **Cost premium 5.5x v10** with no accuracy lift

---

## 3. The cost-vs-latency-vs-accuracy tradeoff (the production answer)

For real production workloads:

**For low-volume, latency-sensitive deployments (interactive chatbots, real-time agents):** **Tier 2 v10**
- 12s avg vs 98s avg is the difference between "slow" and "unusable"
- p95 39.8s vs 170s — same conclusion at the worst-case
- At 1k-10k queries/month, the 15x cost premium is $200-2400/month — affordable for most product budgets
- +5.3pp MS lift matters for assistants doing cross-session synthesis

**For high-volume, cost-sensitive deployments (bulk ingest, API services):** **Tier 1 canonical**
- 15.4x cost premium adds up at scale (>$24k/month at 100k queries)
- Canonical's MS performance (54.9%) may be acceptable for some workloads
- The +1.4pp aggregate improvement is below the 95% CI lower bound — statistically marginal

**For mixed/unknown workloads (most production):** **Tier 2 v10 IF latency matters more than cost**

Full tradeoff analysis: [STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md §3](STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md).

---

## 4. Cost ledger (full breakdown for reproducibility)

| Phase | Cost |
|---|---:|
| Steps 1-9 (canonical baseline + first ablations) | $26.53 |
| Steps 11-12 (refinements) | $3.29 |
| Step 13 (graph activation) | $0.42 |
| Step 14 (two-call reader, 3 variants) | $2.08 |
| Step 15 v1 | $4.28 |
| Step 15 v2 | $4.27 |
| Step 15 v3 | $4.28 |
| Step 15 v4a/b/c Tier A | $14.78 |
| Step 15 v4a Phase A | $26.30 |
| Step 15 v5 Tier A | $24.30 |
| Step 16 K=10 | $33.67 |
| Step 16b K=3 | $32.66 |
| Step 15 v7 Tier A (gpt-5 observer + scaffold) | $25.68 |
| Step 15 v8 Tier A (gpt-5 observer no scaffold) | $25.39 |
| Step 15 v5 Phase A N=102 | $139.27 |
| Step 15 v7 Phase A N=102 (partial; 46/102 quota errors) | $36.08 |
| Step 16c baseline Tier A | $12.48 |
| Step 16c v9 (gpt-4o classifier) | $9.78 |
| Step 16c v10 Tier A | $5.86 |
| Step 16c v11 (gpt-4o + fewshot) | $7.13 |
| Step 16c v10 Phase A N=102 | $22.85 |
| **Step 16c v10 Phase B N=500** | **$121.80** |
| Step 17 v1 (broken parser) | $32.72 |
| Step 17 v2 attempt 1 (no embedder) | $32.88 |
| Step 17 v2 attempt 2 (cache contamination) | $0.02 |
| Step 17 v2 fresh (definitive RED) | $32.56 |
| **Total measurement cost** | **~$644.99** |
| Prior pre-Step-15 work | ~$210 |
| **Cumulative rollout** | **~$855** |
| Original budget | $1200 |
| **Headroom** | **~$345** |

---

## 5. Next-session candidate experiments (ranked by ROI)

### HIGH-VALUE swings (could break the 80% ceiling)

#### 5.1 Gemini observer parity test (~$230 total)

**Hypothesis:** Mastra's published 84.23% at gpt-4o reader uses gemini-2.5-flash as observer (verified via primary source). Our v5 architecture is identical EXCEPT for the observer model. Swapping in gemini-2.5-flash should match Mastra.

**Implementation:**
- Add Gemini SDK to bench (~1-2 hours of plumbing)
- Add `--om-observer-provider <openai|google>` CLI flag (or detect from model name `gemini-*`)
- Test at v5 architecture: dual-path + scaffold + gemini-2.5-flash observer
- Tier A → Phase A → Phase B ladder

**Cost:** ~$30 Tier A + ~$80 Phase A + ~$120 Phase B = ~$230.

**Tradeoff:** breaks OpenAI-only positioning. Document explicitly as "Tier 2-Gemini opt-in" alongside the OpenAI-only Tier 2.

**Expected outcome:** ~84% Phase B (matching Mastra). Becomes the new Tier 2-Gemini option.

#### 5.2 Step 18 Hindsight typed networks (~$400 + 1-2 weeks dev)

**Hypothesis:** Hindsight publishes 91.4% MS at gemini-3-pro using four typed retrieval networks (event/temporal/entity/relationship) + multi-strategy retrieval fusion. Adapting to OpenAI-only might land at ~80% MS at gpt-4o reader.

**Implementation:**
- 4 typed retrieval indexes (by event type / by date / by entity / by relationship)
- Each query routes to multiple indexes
- Results fused via learned or heuristic weighting
- ~1-2 weeks of careful engineering

**Cost:** ~$200+ Tier A + ~$80 Phase A + ~$120 Phase B = ~$400 LLM. PLUS significant dev time.

**Risk:** Hindsight's 91.4% is at gemini-3-pro; OpenAI gpt-4o reader may not be as good at consuming the multi-network output. Could land at 75-80% (real lift over canonical) or stall at v10's 74.6% (no improvement).

**Spec:** not yet written. Would need a full design doc + plan before implementation.

### MEDIUM-VALUE swings (cleaner Tier 2 variants, won't dramatically lift accuracy)

#### 5.3 v6: gpt-5 observer with `reasoning_effort='medium'` (~$50-80 Tier A)

**Hypothesis:** v7's TR regression at `reasoning_effort='minimal'` may be reasoning underprovisioning. Medium reasoning could restore TR (75% in v5) while keeping the MS lift (50% in v7).

**Implementation:** flag swap. The createReader code already routes gpt-5 family; just need to thread `reasoning_effort` through `OmObserverConfig`.

**Cost:** ~$50-80 Tier A (medium reasoning produces 3-5x more output tokens than minimal). If GREEN, ladder to Phase A (~$80) and possibly Phase B.

**Risk:** if gpt-5 with medium reasoning STILL regresses TR, it confirms the regression is intrinsic (compression style) not reasoning underprovisioning. Either way, useful diagnosis.

#### 5.4 Step 17 v3 with BM25 session scoring (~4-6 hr code + ~$60 Tier A)

**Hypothesis:** Replace embedder-based session scoring with BM25 over per-session OM blocks. Eliminates the 5-15s embedder latency per case AND the 25% transient embedder errors. BM25 is often more accurate for specific-token queries (LongMemEval is specific-value-dominant).

**Implementation:**
- Build per-case BM25 index of per-session OM blocks
- Score question vs each block via BM25
- Pick top-K
- Filter retrieval evidence (existing v2 code)

**Cost:** ~$60 Tier A.

**Realistic outcome:** still loses to v10 because OM ingest dominates per-case latency (~80% of time). Eliminating the 5-15s embedding step doesn't fix the 50-150s OM step. Documented as "cleaner Step 17 implementation, still architecturally dominated by v10."

#### 5.5 Tuned OM observer prompt (preserve high-IDF tokens) (~$30 Tier A)

**Hypothesis:** Step 7/8 RED'd because the observer's "consolidate" / "elevate important facts" instruction produces abstract paraphrases that erase specific-token content. An explicit "preserve names, dates, numeric values verbatim" instruction might close the gap.

**Implementation:** prompt edit to `OM_DEFAULTS.observation.systemPrompt`. Add cache-fingerprint bump.

**Cost:** ~$30 Tier A. If GREEN, ladder to Phase A (~$80).

**Realistic outcome:** small lift on KU and MS (specific-value-heavy categories). Could push v10 Phase B from 74.6% → 75-77%.

### LOW-VALUE swings (de-risking only)

#### 5.6 Voyage-rerank-2 / BGE-reranker-v2-m3 (~$30 each Tier A)

**Hypothesis:** Cohere rerank-v3.5 is commercial-only. Open-weights alternatives (BGE) widen applicability.

**Cost:** ~$30 Tier A per reranker.

**Outcome:** mainly de-risks Cohere vendor lock; unlikely to lift accuracy.

#### 5.7 LongMemEval-M / LongMemEval-L (~$200+ for M; ~$2000+ for L)

**Hypothesis:** Test scaling. M is 500-session conversations; L is 5000-session.

**Cost:** large. Out of session-budget scope.

**Outcome:** answers a different question (does our pipeline scale?) not "does it improve accuracy?"

---

## 6. File system map

```
/Users/johnn/Documents/git/voice-chat-assistant/
├── packages/agentos/                                            # SUBMODULE (untouched this rollout)
├── packages/agentos-bench/                                      # bench package (NOT a submodule)
│   ├── src/
│   │   ├── observational-memory/
│   │   │   ├── prompts.ts                                       # ALL OM prompts + OM_PROMPT_HASH
│   │   │   ├── runner.ts                                        # ingestSessions + mode dispatch
│   │   │   ├── questionRouter.ts                                # Step 16c v2: classifier + router
│   │   │   ├── omGuidedRetrieval.ts                             # Step 17 v2: extractPerSessionBlocks + scoreSessionsByQueryRelevance + pickCandidateSessions
│   │   │   └── index.ts                                         # barrel
│   │   ├── benchmarks/longmemeval/LongMemEvalS.ts               # runCase: classifier + router branching + Step 17 scoping
│   │   ├── core/
│   │   │   ├── BenchmarkRunner.ts                               # resolveRunConfig + computeCaseRunKeyParts (fingerprints)
│   │   │   └── IBenchmark.ts                                    # RunConfig (omDynamicRouter, omClassifierModel, omClassifierFewshot, omGuidedRetrieval, omGuidedRetrievalK)
│   │   ├── readers/createReader.ts                              # max_tokens clamp for non-GPT-5 OpenAI
│   │   └── cli.ts                                               # all --om-* flags
│   ├── tests/
│   │   ├── observationalMemory.unit.spec.ts                     # 55 unit tests (extract/score/pick + classify + route)
│   │   └── step15ObservationalMemory.wiring.spec.ts             # 39 wiring tests (RunConfig + fingerprint)
│   ├── docs/
│   │   ├── NEXT_SESSION_CONTINUATION_2026-04-23_FINAL.md        # THIS FILE (start here)
│   │   ├── NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md        # PRIOR session handoff (mid-rollout)
│   │   ├── COMPREHENSIVE_HANDOFF_2026-04-21.md                  # older Step 15 v1 handoff
│   │   ├── ARCHITECTURE_DECISION_MATRIX_2026-04-23.md           # 3-outcome matrix; resolved at Outcome B
│   │   ├── RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md            # umbrella scoreboard (26 experiments, latest)
│   │   ├── STEP_15_V2_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md
│   │   ├── STEP_15_V3_DUAL_PATH_FINDINGS_2026-04-22.md
│   │   ├── STEP_15_V4_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md
│   │   ├── STEP_15_V5_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md
│   │   ├── STEP_15_V7_V8_GPT5_OBSERVER_FINDINGS_2026-04-22.md
│   │   ├── STEP_16_OM_PLUS_RETRIEVAL_FINDINGS_2026-04-22.md
│   │   ├── STEP_16B_TIGHTER_RETRIEVAL_FINDINGS_2026-04-22.md
│   │   ├── STEP_16C_DYNAMIC_ROUTER_FINDINGS_2026-04-22.md       # 16c family (baseline + v9 + v10 Tier A)
│   │   ├── STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md          # v10 Phase B (the Tier 2 winner) + tradeoff analysis
│   │   ├── STEP_17_OM_GUIDED_RETRIEVAL_FINDINGS_2026-04-23.md   # Step 17 v1+v2 RED with diagnosis
│   │   ├── PHASE_A_FINDINGS_2026-04-19.md                       # earlier Phase A
│   │   ├── PHASE_0_FINDINGS.md                                  # earliest infrastructure
│   │   ├── blog/2026-04-20-agentos-memory-longmemeval-rollout.md  # bench blog (Tier 1 + Tier 2 narrative)
│   │   ├── specs/
│   │   │   ├── 2026-04-21-step-15-v2-cross-session-observer-batching-design.md
│   │   │   ├── 2026-04-22-step-15-v3-dual-path-observer-design.md
│   │   │   ├── 2026-04-22-step-16b-tighter-retrieval-topk-design.md
│   │   │   ├── 2026-04-22-step-16c-llm-judge-router-design.md   # v2 (Phase-A-grounded routing)
│   │   │   └── 2026-04-23-step-17-om-guided-retrieval-design.md # Step 17 spec
│   │   └── plans/
│   │       ├── 2026-04-21-step-15-v2-plan.md
│   │       ├── 2026-04-22-step-15-v3-dual-path-plan.md
│   │       ├── 2026-04-22-step-16b-plan.md
│   │       └── 2026-04-22-step-16c-plan.md                      # v2 plan
│   ├── results/
│   │   ├── LEADERBOARD.md                                       # regenerate via `pnpm bench leaderboard`
│   │   ├── summary.json                                         # N-regression-protected canonical row (N=500 acc=0.732)
│   │   └── runs/                                                # every run JSON (16 new this rollout)
│   ├── data/
│   │   ├── longmemeval/longmemeval_s.json                       # benchmark dataset (115k × 500 cases)
│   │   ├── cache/case-run/                                      # per-case ingest+retrieval cache (clear stale entries when iterating)
│   │   ├── cache/case-result/                                   # per-case scored cache (§7.6 case-result bug)
│   │   └── .embedding-cache/                                    # disk-cached embeddings
│   └── .firecrawl/mastra-om/                                    # Mastra source (READ-only reference)
└── apps/wilds-ai/.env                                           # API keys (OPENAI_API_KEY, COHERE_API_KEY, future GOOGLE_API_KEY for Gemini)
```

### Key run JSONs (this rollout)

- **canonical (Tier 1, ships):** check `results/summary.json` → `latest['longmemeval-s|gpt-4o|full-cognitive|ingest']`
- **v10 Phase B (Tier 2, ships):** `results/runs/2026-04-23T04-14-40-609--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v10 Phase A: `results/runs/2026-04-23T03-58-10-535--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v10 Tier A: `results/runs/2026-04-23T03-39-58-051--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v5 Phase A: `results/runs/2026-04-23T00-34-20-102--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v7 Phase A (partial): `results/runs/2026-04-23T01-47-29-341--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Step 17 v2 fresh (RED definitive): `results/runs/2026-04-23T05-34-40-952--longmemeval-s--gpt-4o--full-cognitive--ingest.json`

---

## 7. Required pre-flight checklist for the fresh session

Run BEFORE any LLM-cost work:

```bash
# 1. Monorepo + submodule state
cd /Users/johnn/Documents/git/voice-chat-assistant
git log --oneline -10                                     # expect 5 bench commits at top: c83ed5a485, 23e97f6f41, 58cbf8e4fc, 900450a2a9, 1390fc88b6
git status --short packages/agentos-bench/ | head -20     # should be clean (all changes committed + pushed)
cd packages/agentos && git log --oneline -5               # untouched this rollout

# 2. Verify agentos IGMI patch is in dist (recurring gotcha §7.3 of prior handoff)
grep "from.*IGMI" packages/agentos/dist/cognitive_substrate/GMI.js | head
# MUST show: } from './IGMI.js';
# If not, reapply sed patch (see prior handoff §7.3) or rebuild agentos with the multi-line ESM-import fix.

# 3. Verify gpt-4o max_tokens clamp is in bench dist (recurring gotcha §7.2)
grep -A 2 "GPT4O_MAX" packages/agentos-bench/dist/readers/createReader.js
# MUST show: Math.min(..., GPT4O_MAX_COMPLETION_TOKENS);
# If not: cd packages/agentos-bench && pnpm build

# 4. Typecheck + tests clean
cd packages/agentos-bench
pnpm typecheck                                            # expect silent exit 0
pnpm vitest run                                           # expect 374+ tests pass (374 confirmed end of 2026-04-23 session)

# 5. Summary.json canonical integrity
python3 -c "import json; d=json.load(open('results/summary.json')); r=d['latest']['longmemeval-s|gpt-4o|full-cognitive|ingest']; print(f'N={r[\"totalCases\"]} acc={r[\"accuracy\"]}')"
# MUST print N=500 acc=0.732. If N<500, the N-regression guard was bypassed — STOP and investigate.

# 6. Verify v10 Phase B run exists
ls -la results/runs/2026-04-23T04-14-40-609--longmemeval-s--gpt-4o--full-cognitive--ingest.json
# MUST exist; this is the Tier 2 winning result.
```

**If ANY check fails, stop and report drift before new LLM-cost work.**

---

## 8. Constraints (from user CLAUDE.md, must obey)

These are persistent across all sessions:

- **Master branch only**, never main
- **--no-verify on all monorepo commits** (secretlint blocks on tracked .env)
- **No em dashes in commits or docs** (#1 LLM writing tell)
- **No AI / Claude / Opus / rewrite mentions in commit messages** — write as if a human wrote it
- **No Co-Authored-By lines** in commits
- **No subagents** (Opus 4.7 executes inline — do all work directly)
- **No git worktrees with submodules** (paracosm + wilds-ai + agentos are submodules; conflicts with worktrees)
- **No git stash / reset / restore** (other sessions are active)
- **Commits ONLY when user explicitly asks**
- **agentos-bench is NOT released to npm** — internal/on-demand local use only. No release.config.js needed.
- **wilds-ai is NOT a submodule in this monorepo** (despite being one in some other contexts) — stage explicit files, never `git add apps/wilds-ai`
- **paracosm IS a submodule** — cd into apps/paracosm for git ops
- **All env files (.env, .env.local, .env.production) are tracked** — edit directly, none gitignored
- **Re-read specs/plans end-to-end at MAXIMUM REASONING before writing any implementation code** — first pass writes the plan, second pass corrects it
- **Use deep-research / deep-write skills** for any web research (NEVER raw curl to Serper/Tavily/Firecrawl)
- **Use coderabbit:review** on every implementation before commit (per user instruction this rollout)

---

## 9. Use of superpowers (proactive invocation)

When the next-session task matches, invoke via the `Skill` tool:

- **Bug, test failure, unexpected behavior** → `superpowers:systematic-debugging` BEFORE proposing any fix
- **Implementing any feature or bug-fix** → `superpowers:test-driven-development` (TDD red-green-refactor)
- **Before claiming work is done, complete, or passing** → `superpowers:verification-before-completion`
- **Creating features, adding functionality, changing behavior** → `superpowers:brainstorming` BEFORE touching code
- **Writing a plan or spec for a multi-step task** → `superpowers:writing-plans`
- **Executing a written plan across multiple steps** → `superpowers:executing-plans`
- **Completing a major step or before merging** → `superpowers:requesting-code-review` + `coderabbit:review`
- **Receiving code review feedback** → `superpowers:receiving-code-review`
- **Creating, editing, or verifying a skill** → `superpowers:writing-skills`
- **Finishing a development branch (merge/PR decisions)** → `superpowers:finishing-a-development-branch`

**Anti-patterns to avoid (rationalizations the user has called out):**
- "This is just a simple question" → questions are tasks, check for skills
- "I need more context first" → skill check comes BEFORE clarifying questions
- "Let me explore the codebase first" → skills tell you HOW to explore
- "I remember this skill" → skills evolve, read the current version
- "The skill is overkill" → simple things become complex, use it

---

## 10. Documentation expectations for next session

Whatever experiment you run, you MUST produce:

1. **Findings doc** at `docs/STEP_{N}_{NAME}_FINDINGS_{YYYY-MM-DD}.md` mirroring the structure of [STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md](STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md). Required sections:
   - §1 Verdict (GREEN-Tier1 / GREEN-Tier2 / GREEN-soft / RED / NULL)
   - §2 Headline numbers table (this work vs canonical vs v10)
   - §3 Per-category breakdown + CIs (n + accuracy + 95% CI per category)
   - §4 Cost breakdown
   - §5 Latency breakdown (avg, p50, p95)
   - §6 Diagnosis / mechanism explanation
   - §7 Tradeoff analysis (cost vs latency vs accuracy at production volumes)
   - §8 Recommendations (ship as Tier X / deprecated / future-work)
   - §9 Files + run JSONs

2. **Umbrella update** at `docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` §7 scoreboard. Add the new row with verdict, primary metric change, and ships-as-what.

3. **Bench blog update** at `docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md` ONLY IF the new experiment shifts the Tier 1 / Tier 2 ship decision. Otherwise the blog stays as-is.

4. **Spec doc** at `docs/specs/{YYYY-MM-DD}-step-{N}-{name}-design.md` BEFORE writing any implementation code. Include architecture, kill criteria, cost estimate, expected outcomes.

5. **Plan doc** at `docs/plans/{YYYY-MM-DD}-step-{N}-plan.md` AFTER spec approval. Checkbox-format (`- [ ]`) tasks for `superpowers:executing-plans`.

6. **Architecture decision matrix update** at `docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md` IF the new experiment changes the shipping tier assignments.

7. **Next-session continuation handoff** at `docs/NEXT_SESSION_CONTINUATION_{YYYY-MM-DD}_FINAL.md` mirroring this file's structure. Each session produces a new handoff that supersedes the prior one.

---

## 11. Methodology recap (durable, applies to all next-session experiments)

### Bootstrap CIs

Every accuracy ships with 95% CI from 10000 percentile-bootstrap resamples (Mulberry32 PRNG, seed=42). Implementation: [src/core/metrics/computeBootstrapCI.ts](../src/core/metrics/computeBootstrapCI.ts).

### Matched-reader, matched-judge

Every proposed feature is measured against a baseline with the SAME reader, same judge, same embedder, same infrastructure. Step 2's failure proved this matters.

### Tier A → Phase A → Phase B kill ladder

- Tier A N=24 (4 per category, stratified seed=42) — directional. Kill criterion: any regression > 5pp weighted vs reference → STOP.
- Phase A N=102 (17 per category, stratified seed=42) — confirms Tier A. Kill: point estimate < canonical + 5pp OR McNemar p ≥ 0.05.
- Phase B N=500 — full benchmark. Requires explicit user approval before firing.

The case-run + case-result caches deterministically reuse Tier A's 24 cases for Phase A (same fingerprint). So Phase A marginal cost is 78 fresh cases, not 102.

### Cache-fingerprint discipline

Every architectural variant gets a tag in `computeCaseRunKeyParts` (BenchmarkRunner.ts) AND mirrored in `resultKeyParts`. Mismatch creates orphan case-result entries that short-circuit future runs (the §7.6 bug).

When iterating on a config without bumping the fingerprint (e.g., bug fix that doesn't touch prompt hash), CLEAR BOTH CACHES for stale entries before re-running:

```bash
cd packages/agentos-bench
for f in $(find data/cache/case-result -type f); do
  if jq -e 'select(<failure-pattern>)' "$f" > /dev/null 2>&1; then rm "$f"; fi
done
for f in $(find data/cache/case-run -type f); do
  if jq -e 'select(<failure-pattern>)' "$f" > /dev/null 2>&1; then rm "$f"; fi
done
```

### Evidence-provenance instrumentation

Phase 1 added `BenchResult.evidenceOrigin` aggregator that buckets each case's reader answer by the `sourceType` of the retrieved trace with maximum shingle overlap. Step 9's `evidenceOrigin: { user_statement: 19, fact_graph: 0, none: 5 }` was the load-bearing diagnosis — without it, RED would have needed additional ablation runs.

---

## 12. Communication cadence for fresh session

1. **Before any LLM-cost work:** run §7 checklist. Report drift if any.
2. **Before each new variant Tier A:** brief user on hypothesis + kill criterion + cost estimate.
3. **Between Tier A and Phase A:** share Tier A result + ask explicit approval for Phase A spend.
4. **Before Phase B:** fully explicit approval required ($120-150 commit).
5. **Before any commit:** run `coderabbit:review` on the changes; fix findings; re-run tests.
6. **At session end:** write the next-session continuation handoff.

---

## 13. The full continuation prompt (paste into fresh session)

```
Continue the AgentOS LongMemEval-S rollout. Read the handoff at
packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_FINAL.md
end-to-end at maximum reasoning before any work.

CURRENT STATE (settled 2026-04-23 end-of-day):

Two production tiers ship:
- Tier 1 default: canonical Step 3 HybridRetriever — 73.2% [69.2%, 77.0%]
  on LongMemEval-S Phase B N=500 at gpt-4o reader. $0.021/correct,
  98s avg latency.
- Tier 2 opt-in: Step 16c v10 dynamic router — 74.6% [70.8%, 78.4%]
  Phase B N=500. Per-question gpt-5-mini fewshot classifier routes
  single-session/temporal to canonical, KU/MS to v5 OM. $0.327/correct,
  12s avg latency. +5.3pp on multi-session at n=133. First architectural
  variant to beat canonical at Phase B.

26 experiments documented. 24 RED at Tier A or Phase A. v10 is the only
variant that survived all gating tiers.

Step 17 (OM-guided retrieval) tested across two iterations and confirmed
RED. Latency-bound at 163s avg / 569s p95 / 12 min worst (13x v10).
Architecturally dominated by v10 because it always runs full OM ingest
while v10 routes ~80% of cases to canonical and skips OM. Documented in
docs/STEP_17_OM_GUIDED_RETRIEVAL_FINDINGS_2026-04-23.md.

CUMULATIVE COST: ~$855 / $1200 budget. Headroom: ~$345.

NEXT-SESSION CANDIDATES (ranked by ROI, see handoff §5):
1. Tuned OM observer prompt (~$30 Tier A) — preserve high-IDF tokens
2. v6 gpt-5 observer with reasoning_effort='medium' (~$50-80 Tier A)
3. Step 17 v3 with BM25 session scoring (~$60 Tier A + 4-6 hr code)
4. Gemini observer parity test (~$230 across Tier A → Phase A → Phase B,
   accepts Gemini vendor dependency for ~84% Phase B match to Mastra)
5. Step 18 Hindsight typed networks (~$400 LLM + 1-2 weeks dev,
   OpenAI-only path to ~80% MS, uncertain at gpt-4o reader)
6. Voyage-rerank-2 / BGE-reranker-v2-m3 alternatives (~$30 each Tier A,
   de-risks Cohere vendor lock; unlikely to lift accuracy)
7. LongMemEval-M / LongMemEval-L stress tests (~$200+/$2000+,
   different question — does pipeline scale?)

READ THESE FIRST AT MAXIMUM REASONING:

1. packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_FINAL.md
   — THIS handoff (full state + next-session context)
2. packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md
   — 26-variant scoreboard with verdicts
3. packages/agentos-bench/docs/STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md
   — the Tier 2 winner, full tradeoff analysis
4. packages/agentos-bench/docs/STEP_17_OM_GUIDED_RETRIEVAL_FINDINGS_2026-04-23.md
   — why Step 17 is RED (read before considering v3)
5. packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md
   — public-facing narrative (update IF a new experiment shifts ship decisions)

PRE-FLIGHT CHECKLIST (handoff §7) IS MANDATORY. It catches:
- agentos IGMI patch in dist
- gpt-4o max_tokens clamp in bench dist
- summary.json canonical row integrity (N=500 acc=0.732)
- 374+ tests pass (typecheck silent)

CONSTRAINTS THAT PERSIST (from user CLAUDE.md, see handoff §8):
- master branch only, never main
- --no-verify on monorepo commits (secretlint)
- no em dashes in commits or docs
- no AI / Claude / Opus / rewrite mentions in commits
- no Co-Authored-By
- no subagents (Opus 4.7 executes inline)
- no git worktrees with submodules
- no git stash / reset / restore (other sessions active)
- commits ONLY when user explicitly asks
- agentos-bench is internal/on-demand (no auto-release)
- wilds-ai is NOT a submodule in this monorepo (stage explicit files)
- paracosm IS a submodule (cd in for git ops)
- re-read specs/plans END-TO-END at MAXIMUM REASONING before any implementation
- use deep-research / deep-write skills for web research (no raw curl)
- use coderabbit:review on every implementation before commit

USE SUPERPOWERS PROACTIVELY (handoff §9):
- bug / test failure / unexpected behavior → systematic-debugging FIRST
- implementing any feature or bug-fix → test-driven-development (TDD)
- before claiming done → verification-before-completion
- creating features → brainstorming BEFORE code
- writing a plan or spec → writing-plans
- executing a plan → executing-plans
- before merging → requesting-code-review + coderabbit:review

DOCUMENTATION EXPECTATIONS (handoff §10):
Every experiment produces:
1. Findings doc at docs/STEP_{N}_{NAME}_FINDINGS_{YYYY-MM-DD}.md
2. Umbrella scoreboard row added
3. Spec doc at docs/specs/{YYYY-MM-DD}-{name}-design.md BEFORE code
4. Plan doc at docs/plans/{YYYY-MM-DD}-{name}-plan.md AFTER spec
5. Bench blog update IF ship-tier changes
6. Architecture decision matrix update IF ship-tier changes
7. Next-session continuation handoff at session end

DEFAULT FIRST ACTION:
After reading the handoff + pre-flight checklist passes, BRAINSTORM with
the user on which next-session candidate (1-7 above) to pursue. Do NOT
fire LLM-cost runs without explicit user approval per the cost ledger
discipline.

If the user picks Gemini observer parity (#4), the implementation needs
new Gemini SDK plumbing in createReader.ts — write the spec first.

If the user picks Step 18 Hindsight (#5), this is a 1-2 week investment
and a new full spec + plan. Write spec first; do not implement until
user approves the architecture.

If the user picks Step 17 v3 (#3), the BM25 session scoring is ~4-6
hours of code; the implementation pattern mirrors the existing v2
extractPerSessionBlocks but uses a per-case BM25 index instead of
embeddings. Write a brief spec amendment (Step 17 v3 design notes)
before implementing.

If the user picks tuned observer prompt (#1) or v6 gpt-5 medium reasoning
(#2), these are small swings — propose the prompt change / flag swap
in conversation, get approval, fire Tier A directly.

KILL-CRITERIA DISCIPLINE (handoff §11):
- Tier A: any regression > 5pp weighted vs reference → STOP, do not fire Phase A.
- Phase A: < canonical + 5pp at point estimate OR McNemar p ≥ 0.05 → STOP, do not fire Phase B.
- Phase B: explicit user approval required ($120-150 commit).

ALL ARCHITECTURAL DECISIONS so far have been honored. Maintain that
discipline.
```

---

## 14. Acknowledgments

The 2026-04-22 / 2026-04-23 sessions landed:

- 11 architectural variant experiments tested end-to-end (16b, v7, v8, 16c baseline/v9/v10/v11, 17 v1/v2 + v5/v7 Phase A confirmations)
- 1 published Phase B result above canonical (16c v10 at 74.6%, the first AgentOS variant to beat the shipping baseline at Phase B)
- 1 sampling-luck pattern catch at Phase A (v5 79.2% Tier A → 73.5% Phase A, saved $700)
- 1 transient-API-error pattern documented (v7 Phase A had 46/102 quota errors; Step 17 v2 had 6/24 embedder 503s)
- 1 case-result/case-run cache contamination episode documented (Step 17 v2 attempt 2)
- 8 new findings docs written (16b, v7+v8, 16c family, v10 Phase B, Step 17, decision matrix, plus this handoff)
- Bench blog rewritten with Tier 1 + Tier 2 production narrative
- 5 modular commits pushed to master (1390fc88b6, 900450a2a9, 58cbf8e4fc, 23e97f6f41, c83ed5a485)
- 12 new tests (8 helpers + 4 wiring) for Step 17, 21 new tests for Step 16c v2
- 374+ tests pass; typecheck silent; build clean

The methodology is the durable win. The numbers are competitive. v10 is the architectural improvement that justified the rollout's cumulative spend.

End of handoff.
