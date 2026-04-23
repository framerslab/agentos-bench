# Final Architecture Decision Matrix (RESOLVED)

**Date:** 2026-04-23 (matrix authored during Phase B v10 inflight; resolved end-of-day-3 after Phase B v10 + Step 17 v1/v2 landed)
**Status:** **DECISION SETTLED — Outcome B + Step 17 RED**
**Purpose:** decisive go/no-go on the AgentOS LongMemEval-S architecture.

---

## What's settled (verified)

- **Canonical (Step 3 HybridRetriever):** **73.2% [69.2%, 77.0%]** N=500 at gpt-4o reader + gpt-4o judge. $0.0213/correct. Shipping default since 2026-04-20.
- **v5 (OM dual-path + scaffold + gpt-4o observer):** 73.5% Phase A N=102. **Statistically tied with canonical** at this N. Pareto-different per-category profile (MS +15.7pp, TR -17.3pp, SSA -12.8pp). Sampling-luck pattern matches v4a (Tier A 79.2% → Phase A 73.5%).
- **v7 (gpt-5 observer):** Phase A 29.4% with 46/102 cases erroring on OpenAI quota. On 56 typed cases, v7 was strictly worse than v5 across every category. **gpt-5 observer's MS lift at Tier A was sampling artifact.**
- **Step 16 family (OM + retrieval combined):** ALL RED at Tier A (K=10: 70.8%, K=3: 70.8%). Stacking pollutes single-session by adding distractor passages.
- **16c routing v10 (gpt-5-mini + fewshot prompt):** **76.5% [67.6%, 84.3%] Phase A N=102** — first variant to beat canonical at Phase A. **6x cheaper than v5** ($22.85 vs $139.27 at N=102). Awaits Phase B confirmation.
- **16c v9, v11:** WORSE than v10 at Tier A. Won't be tested at Phase A (low ROI).

---

## RESOLVED: Phase B v10 LANDED at 74.6% [70.8%, 78.4%] = Outcome B band

Phase B v10 result (full at [STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md](STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md)):
- Aggregate: 74.6% (+1.4pp over canonical 73.2%, CIs overlap)
- MS: 60.2% (+5.3pp over canonical 54.9%) — the architectural lift
- SSA: 83.9% (-5.4pp vs canonical 89.3%) — accept this loss for the MS win
- Cost: $0.327/correct (15.4x premium); Latency: 12s avg (8.3x faster than canonical's 98s)

**Decision applied (Outcome B band):**
- **Tier 1 default: canonical (Step 3 Hybrid)** — 73.2% proven, $0.021/correct, simplest
- **Tier 2 opt-in: 16c v10 dynamic router** — 74.6% Phase B verified, +5.3pp MS, 8x faster latency, 15x cost premium
- v5 → Tier 3 experimental
- Step 17 → tested in same session, RED (see below)

## Step 17 (OM-guided retrieval) RESOLVED RED

After Phase B v10 landed, Step 17 was implemented and tested (v1 broken parser → v2 working) per the user direction "do step 17 in full":

- **v1 (broken parser):** RED 70.8% Tier A — parser expected `(session sX)` markers that don't exist
- **v2 (refactored to use perSessionBatches directly):** RED 50.0% Tier A with 25% cases erroring on transient OpenAI embedder 503s; 66.7% on completed cases
- **Latency:** 163s avg, 569s p95, worst 12 min (13x slower than v10)
- **Cost:** $32.56 Tier A (5.5x v10) with no accuracy lift
- **Architecturally dominated by v10:** v10 routes ~80% of cases to canonical (no OM), Step 17 always runs full OM ingest

Full Step 17 findings: [STEP_17_OM_GUIDED_RETRIEVAL_FINDINGS_2026-04-23.md](STEP_17_OM_GUIDED_RETRIEVAL_FINDINGS_2026-04-23.md). Step 17 ships as opt-in `--om-guided-retrieval` flag for future iteration but is **NOT production**.

---

## Original outcome matrix (kept for reference; Outcome B applied)

Three possible outcomes, each with a clear shipping decision:

### Outcome A: Phase B v10 ≥ 75% (CI lower bound ≥ 70%)

**Architectural win confirmed.** v10 routing definitively beats canonical at scale.

**Ship decision:**
- **Tier 1 default:** v10 (16c dynamic router with fewshot classifier)
- **Tier 2 opt-in:** canonical (Step 3 Hybrid) for users who want simplest path / lowest cost-per-correct
- **Documented as deprecated:** v5 OM-only (superseded by v10's better routing)

**Bench blog headline update:**
> "AgentOS achieves [X]% on LongMemEval-S Phase B N=500 at gpt-4o reader via per-question dynamic routing — +[X]pp over canonical at matched reader. 6x cheaper to run than static OM. Production-ready Tier 1 default."

**Cost:** Ships 16c-v10 as default; runtime overhead = 1 gpt-5-mini classifier call per query (~$0.0005). Canonical opt-in remains zero-overhead.

### Outcome B: Phase B v10 in 73-75% (statistically tied with canonical)

**Pareto-different operating point, NOT a clear win.** Same aggregate as canonical, different per-category profile.

**Ship decision:**
- **Tier 1 default:** canonical (Step 3 Hybrid) — proven, simplest, cheapest
- **Tier 2 opt-in:** v10 (16c routing) — for workloads that benefit from per-category routing trade
- **Documented as Pareto-different:** users pick canonical or v10 based on per-category preference

**Bench blog update:**
> "AgentOS Tier 1 canonical: 73.2%. Tier 2 16c routing: similar aggregate, different per-category profile (better MS, worse SSA). Choose by workload."

**Cost:** Ships canonical as default; v10 is opt-in.

### Outcome C: Phase B v10 < 73% (sampling luck pattern)

**Phase A 76.5% was sampling artifact** (opposite of v4a's pattern but same family of issue).

**Ship decision:**
- **Tier 1 default:** canonical (Step 3 Hybrid) — ONLY proven option
- **Tier 2 opt-in:** none new (v5 OM also tied; nothing else won)
- **Future work:** Step 17 (OM-guided retrieval — spec at [docs/specs/2026-04-23-step-17-om-guided-retrieval-design.md](specs/2026-04-23-step-17-om-guided-retrieval-design.md)) becomes the next architectural swing

**Bench blog update:**
> "AgentOS canonical: 73.2% N=500. Multi-step routing approaches (16c family) tied with canonical at matched reader; per-category routing unable to break the canonical Pareto frontier at this scale. Future work: Step 17 OM-guided retrieval."

**Cost:** No production change. Canonical remains default.

---

## Outcome-independent decisions (settle now)

Regardless of Phase B v10 outcome, these are settled:

### 1. Ship canonical (Step 3 Hybrid) is the proven floor

Whatever else wins/loses, canonical's 73.2% N=500 is the ground-truth shipping baseline. Don't deprecate without N=500 confirmation of an alternative.

### 2. v5 OM-only is documented as Pareto-different opt-in

73.5% Phase A tied with canonical. Per-category profile is materially different. Ships as Tier 3 opt-in for workloads that specifically want MS lift at TR cost.

### 3. v7/v8 (gpt-5 observer) NOT shipped

Phase A confirmed worse than v5 across every category. The "OpenAI observer ceiling" insight is documented but the variant doesn't ship.

### 4. Step 16 family NOT shipped (RED at Tier A)

Both K=10 and K=3 architecturally dominated by v5. Documented as failed approach.

### 5. Step 16c v10 ships at SOME tier regardless

- If Phase B GREEN (Outcome A): Tier 1 default
- If Phase B tied (Outcome B): Tier 2 opt-in
- If Phase B RED (Outcome C): Tier 3 experimental opt-in (architectural curiosity but not production)

### 6. Methodology + 18 negative results documented

All RED variants stay in the bench codebase as opt-in flags so future rollouts can re-test if foundational changes (new reader model, different judge) shift the Pareto frontier.

---

## Tier sourcing for production

Final shipping tiers (after Phase B v10 lands):

| Tier | Config | Provenance | When to use |
|---|---|---|---|
| Tier 1 (default) | Step 3 Hybrid OR 16c-v10 (per Phase B outcome) | 73.2% N=500 OR ~76% N=500 | All workloads, default |
| Tier 2 (opt-in) | The other of {Step 3 Hybrid, 16c-v10} | tied or close | Cost-sensitive (canonical) OR per-category-routing-aware (v10) |
| Tier 3 (experimental) | v5 OM-only | 73.5% Phase A | Workloads that explicitly want MS lift, accept TR/SSA loss |
| Deprecated | All Step 16 family, v7/v8 | RED | Documented but not shipped |

---

## Future work (if Phase B v10 doesn't fully resolve)

If Outcome A or B: **Step 17 (OM-guided retrieval)** at next session. Spec at [docs/specs/2026-04-23-step-17-om-guided-retrieval-design.md](specs/2026-04-23-step-17-om-guided-retrieval-design.md). Design tests whether scoping HybridRetriever to OM-identified candidate sessions escapes both Step 16's pollution AND v10's MS ceiling.

If Outcome C: Step 17 becomes critical (only remaining architectural swing). Same spec applies.

Either way, Step 17 implementation is **deferred to next session** to avoid speculative work during Phase B inflight.

---

## Cost summary at decision point

Cumulative session spend (LLM): ~$494 + Phase B v10 estimated ~$120 = **~$614**.

Original budget approval: ~$1200. Headroom: ~$586 if we want to do Step 17 next session ($60 Tier A + ~$80 Phase A + ~$120 Phase B).

---

## What needs to happen at decision time

1. Phase B v10 result lands.
2. Compare against this matrix; pick Outcome A/B/C.
3. Update bench blog with the corresponding headline + caveats.
4. Update umbrella scoreboard with Phase B v10 row.
5. Write Phase B v10 findings doc.
6. Commit all uncommitted bench docs (per user policy: only on explicit ask).
7. Decide Step 17 timing for next session.

---

End of architecture decision matrix.
