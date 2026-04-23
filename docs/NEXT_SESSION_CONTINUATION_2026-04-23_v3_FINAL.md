# Fresh-Session Continuation Handoff — 2026-04-23 v3 (Post Step 18 v2 Phase B 75.4% + Step 19 NULL)

**Supersedes:** [NEXT_SESSION_CONTINUATION_2026-04-23_v2_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-23_v2_FINAL.md). The v2 handoff is OUTDATED — Step 18 v2 Phase B has now landed at 75.4% [71.6%, 79.0%] N=500 (+0.8pp over v10 baseline within noise, +2.2pp over canonical, +6.8pp on MS vs canonical). Step 19 spec was implemented and tested at Tier A — NULL on the targeted MS metric.

**Status at handoff:** Step 18 v2 conditional reader prompt (verbatim citation rule on KU+SSU) confirmed at Phase B and ships as **Tier 2 v11 production opt-in**. Step 19 conditional retriever tuning falsified at Tier A (3 mechanisms tested, none moved canonical's MS bottleneck). Per-correctness retention split methodology shipped as the durable scientific contribution this session. Total session spend ~$275 of approved $1k+. Headroom ~$725.

**This document is self-contained.** Read end-to-end at maximum reasoning. Paste the §15 prompt into the fresh session.

---

## 0. The 90-second briefing

**What's settled this session (2026-04-23 day 4-5):**

1. **Step 18 token-retention framework shipped.** New `BenchResult.tokenRetention` aggregator with per-stage rates + per-correctness split. Cross-tier baselines surfaced two diagnostic signals: (a) reader-stage paraphrase is the dominant token-loss layer for OM tiers (87-95% observer → 69-73% reader = 25pp drop), (b) canonical's MS retriever drops 63.5% of gold tokens (largest single-stage drop in matrix).
2. **Step 18 v1 (uniform reader verbatim rule): RED at Tier A**, $32.52. TR collapsed −50pp because the rule forced reader to quote raw timestamps where temporal answers require COMPUTING dates.
3. **Step 18 v2 metric refinement (per-correctness split): GREEN-framework**, $0. The methodological contribution. Predicts variant ROI by partitioning retention into whenCorrect / whenWrong buckets.
4. **Step 18 v2 conditional reader (KU+SSU eligible): GREEN-soft Tier A 66.7% reproducible across 2 fires + Phase A 78.4% [69.6%, 86.3%] + Phase B 75.4% [71.6%, 79.0%].** Ships as Tier 2 v11. +0.8pp over v10 baseline at point estimate (within noise). +6.8pp on MS vs canonical (the architectural story). Total v2 spend $227.43.
5. **Step 18 v3 (added SSA to eligible): NULL** ties v2 at Tier A, $6.03 (wasted; lesson: per-correctness gap +0.50 is too borderline).
6. **Step 19 conditional retriever tuning (3 variants K=30 / BM25=0.7 / overfetch=6.0 for MS): NULL at Tier A** $7.92. All 3 variants verified to apply override on 4/4 MS cases via metadata, but NONE moved MS accuracy above the 25% canonical baseline. Falsifies the hypothesis that simple retriever knobs can close canonical's MS rawToRetrieved 0.365 gap. Three independent mechanisms failed.
7. **Stacked test (Step 19 B + canonical-mode Step 18 v2): NULL** ties baseline. Confirmed Step 19 B/C's apparent +4.2pp Tier A lifts were TR variance, not real architectural wins.

**Cumulative session spend: ~$275 / $1000+ approved. Headroom ~$725.**

---

## 1. Final shipping tiers (post Step 18 v2 Phase B)

| Tier | Config | Phase B accuracy | Cost/correct | Avg latency | When to use |
|---|---|---:|---:|---:|---|
| **Tier 1 default** | canonical (Step 3 Hybrid) | **73.2% [69.2%, 77.0%]** N=500 | **$0.021** | 98s | High-volume, cost-sensitive |
| **Tier 2 opt-in** | 16c v10 dynamic router | **74.6% [70.8%, 78.4%]** N=500 | $0.327 | **12s** | Latency-sensitive, MS-heavy |
| **Tier 2 v11 opt-in (NEW)** | v10 + Step 18 v2 conditional reader (KU+SSU verbatim) | **75.4% [71.6%, 79.0%]** N=500 | $0.436 | 14s | Same as v10, marginal MS lift |
| Tier 3 experimental | v5 OM-only | 73.5% Phase A | high | 35s | Pareto-different per-category |
| Deprecated/RED | v7, v8, Step 16, 16b, 16c-baseline/v9/v11, Step 17 v1+v2, Step 18 v1, Step 19 A/B/C | various | n/a | varies | documented failures |

### Tier 2 v11 vs v10 honest tradeoff

- **+0.8pp aggregate** at point estimate (75.4% vs 74.6%), CIs overlap so within noise
- **+1.5pp on multi-session** (61.7% vs 60.2%) — the architectural story
- **+1.3x cost-per-correct** ($0.436 vs $0.327)
- **Same latency profile** (14s vs 12s)
- **Same architecture as v10** + `CONDITIONAL_VERBATIM_CITATION` appended to OM reader prompt for KU/SSU classified questions

If MS lift matters more than the cost premium, ship v11. If aggregate-tied within noise feels like premature ship-decision, keep v10 as Tier 2 default and document v11 as experimental opt-in.

---

## 2. The complete 35-variant scoreboard

All rows at gpt-4o reader + gpt-4o judge unless noted. CIs are bootstrap percentile, 10000 resamples, seed=42.

| Step | Variant | Verdict | N | Result | Cost |
|---|---|---|---:|---|---:|
| 1-17 | (prior 26-experiment rollout — see umbrella scoreboard §7) | various | various | Tier 1 canonical 73.2% / Tier 2 v10 74.6% Phase B | ~$645 |
| 18 framework | Token-retention metric across 3 tiers | GREEN-framework | 24 each | identified canonical MS retriever as +63pp opportunity | $39.02 |
| 18 v1 | Uniform reader verbatim-citation rule | RED | Tier A 24 | v5 −16.7pp; TR collapsed −50pp; tune lifted wrong-case retention +40pp (over-confident wrong answers) | $32.52 |
| 18 v2 metric | Per-correctness retention split | GREEN-framework | re-aggregation | Cache-hit, $0. Predicts variant ROI before LLM spend | $0 |
| 18 v2 conditional Tier A | KU+SSU eligible, gated on classifier | GREEN reproducible | 24 × 2 fires | 66.7% (+4.2pp) both fires; per-correctness gap widened from +0.500 to +0.664 | $11.72 |
| 18 v2 conditional Phase A | KU+SSU at N=102 | GREEN-soft passes kill gate | 102 | 78.4% [69.6, 86.3] passes canonical+5pp by 0.2pp; +1.9pp v10 PA | $25.63 |
| 18 v3 | v2 + added SSA to eligible list | NULL | 24 | 66.7% ties v2; SSA unchanged at 75% | $6.03 |
| 19 A/B/C | Conditional retriever for MS (3 variants, canonical mode) | **NULL on MS** | 24 each | All 3 applied override correctly on MS cases; MS accuracy unchanged at 25%; aggregate variance from TR was noise | $7.92 |
| 19 stacked | Step 18 v2 verbatim + Step 19 B BM25 on canonical | NULL | 24 | 62.5% baseline; falsified the Tier A gains of B/C | $0.49 |
| **18 v2 Phase B** | v10 + Step 18 v2 conditional at N=500 | **GREEN-soft (ships v11)** | 500 | **75.4% [71.6, 79.0]** +0.8pp v10 (within noise); MS +6.8pp canon, +1.5pp v10; SSA -5.4pp canon (n=56 noise); cost $0.436/correct | $164.45 |

Cumulative session spend: **~$275** of $1000+ approved.

---

## 3. Step 18 framework architecture (durable artifact)

The token-retention metric ships as the durable scientific contribution. It works for any RAG architecture; the per-correctness split predicts variant ROI before LLM spend.

### 3.1 Module structure

```
src/core/metrics/
├── stopwords.ts                    # NLTK 3.8 + chat-style stoplist (frozen)
├── extractHighIdfTokens.ts         # NFKD + lowercase + stoplist + 2-char min
├── scoreStageRetention.ts          # fraction-of-tokens substring scorer
└── computeTokenRetention.ts        # per-stage + per-correctness aggregator
```

### 3.2 BenchResult schema

```typescript
interface BenchResult {
  // ... existing fields ...
  tokenRetention?: TokenRetentionResult;
}

interface TokenRetentionResult {
  perCategory: Record<string, TokenRetentionPerCategory>;
  overall: TokenRetentionPerCategory;
  perCorrectness?: {
    perCategory: Record<string, TokenRetentionPerCorrectness>;
    overall: TokenRetentionPerCorrectness;
  };
  excluded: TokenRetentionExclusion[];
}

interface TokenRetentionPerCorrectness {
  whenCorrect: TokenRetentionPerCategory;
  whenWrong: TokenRetentionPerCategory;
}
```

### 3.3 Per-case metadata captured

```typescript
runMetadata.expected = c.expected;            // gold answer
runMetadata.type = c.type;                    // category
runMetadata.caseType = c.type;                // legacy alias
runMetadata.omFinalLog = ingest.finalLog;     // OM observer output (full text)
runMetadata.retrievedEvidence = out.retrievedEvidence;  // structured retrieved chunks
```

### 3.4 Cache fingerprint

`retention-instrumentation:v1` pushed to BOTH runKeyParts and resultKeyParts at the end of `computeCaseRunKeyParts`. One-time bump.

### 3.5 Step 18 v2 conditional reader plumbing

```typescript
// src/observational-memory/runner.ts
const VERBATIM_CITATION_ELIGIBLE_CATEGORIES: ReadonlySet<string> = new Set([
  'knowledge-update',
  'single-session-user',
  // SSA was added in v3 then reverted after Tier A NULL.
]);

export function buildOmReaderSystemPrompt(observationLog: string, opts: {
  includeScaffold?: boolean;
  retrievedPassages?: readonly OmReaderRetrievedPassage[];
  routerCategory?: string;  // Step 18 v2: appends CONDITIONAL_VERBATIM_CITATION when KU/SSU
}): string;
```

### 3.6 Step 19 retriever override plumbing (durable, NULL'd this session but reusable)

```typescript
// CLI flags
--om-retriever-ms-k <n>
--om-retriever-ms-bm25-weight <w>
--om-retriever-ms-overfetch <m>

// Per-case override fires when c.type === 'multi-session' (ground truth, not router output)
// Wired through runFullCognitiveCase as new optional params:
runFullCognitiveCase(..., hybridSparseWeightOverride, hybridOverFetchMultiplierOverride)
```

---

## 4. Per-correctness retention split as variant-ROI predictor (durable methodology)

| Category | Gap (correct − wrong) avg across baselines | Predictor strength | Implication |
|---|---:|---|---|
| single-session-user | +1.00 | Perfect | Retention IS the answer |
| knowledge-update | +0.83 | Strong | Verbatim quoting helps |
| single-session-assistant | +0.50 | Borderline | Tested in v3 → NULL |
| single-session-preference | +0.32 to +0.52 | Borderline | Mostly paraphrase-OK |
| multi-session | +0.31 to +0.85 | Architecture-dependent | Reader-side helps; retriever knobs don't |
| temporal-reasoning | +0.60 to **−0.54** | Unstable, sometimes anti-correlated | Synthesis required; verbatim hurts |

### Discipline going forward

1. **Reader-side variant decisions:** require gap ≥ +0.6 across ≥ 2 baseline architectures. (KU+SSU passed; SSA failed.)
2. **Retriever-side variant decisions:** per-correctness gap is NECESSARY but NOT SUFFICIENT. Also need a specific mechanism story for why the knob moves retention. (Step 19 had the gap but no validated mechanism; falsified.)

---

## 5. Files + run JSONs (this session)

### Step 18

- Findings: [docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md](STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md) (full v1+v2+v3+Phase A+Phase B)
- Spec: [docs/specs/2026-04-23-token-retention-framework-design.md](specs/2026-04-23-token-retention-framework-design.md)
- Plan: [docs/plans/2026-04-23-token-retention-framework-plan.md](plans/2026-04-23-token-retention-framework-plan.md)
- Run JSONs: see Step 18 findings §9 and §16

### Step 19

- Findings: [docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md](STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md)
- Spec: [docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md](specs/2026-04-23-step-19-conditional-retriever-tuning-design.md)
- Plan: [docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md](plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md)
- Run JSONs: 4 variants + stacked, listed in Step 19 findings §9

### Step 18 v2 Phase B (THE WINNER)

- Run JSON: `results/runs/2026-04-23T17-27-28-793--longmemeval-s--gpt-4o--full-cognitive--ingest.json`

### Source modules touched

- New (Step 18): `src/core/metrics/{stopwords,extractHighIdfTokens,scoreStageRetention,computeTokenRetention}.ts`
- Modified (Step 18): `src/core/metrics/index.ts`, `src/core/IBenchmark.ts` (BenchResult.tokenRetention?), `src/core/BenchmarkRunner.ts` (retention-instrumentation:v1 fingerprint), `src/benchmarks/longmemeval/LongMemEvalS.ts`, `src/observational-memory/prompts.ts` (CONDITIONAL_VERBATIM_CITATION), `src/observational-memory/runner.ts` (buildOmReaderSystemPrompt routerCategory param)
- Modified (Step 19): `src/core/IBenchmark.ts` (3 new RunConfig fields + Omit/Pick), `src/core/BenchmarkRunner.ts` (3 new fingerprints), `src/cli.ts` (3 new flags), `src/benchmarks/longmemeval/LongMemEvalS.ts` (per-case override resolution + threading to runFullCognitiveCase + hybridSparseWeight + hybridOverFetchMultiplier params)
- New tests (Step 18): `tests/{stopwords,extractHighIdfTokens,scoreStageRetention,computeTokenRetention,computeTokenRetention.integration,buildOmReaderSystemPrompt}.spec.ts`
- Modified tests: `tests/step15ObservationalMemory.wiring.spec.ts` (+5 fingerprint tests), `tests/readerTopK.spec.ts` (length-pin update)

**Most changes already committed by parallel session at commit `316a88f99`.** This handoff captures any uncommitted final-state edits (Step 19 implementation refinements + Phase B run JSON).

---

## 6. Required pre-flight checklist for the fresh session

Run BEFORE any LLM-cost work:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git log --oneline -10
git status --short packages/agentos-bench/ | head -20

# Verify agentos IGMI patch
grep "from.*IGMI" packages/agentos/dist/cognitive_substrate/GMI.js | head

# Verify gpt-4o max_tokens clamp
grep -A 2 "GPT4O_MAX" packages/agentos-bench/dist/readers/createReader.js

cd packages/agentos-bench
pnpm typecheck                    # silent exit 0
pnpm vitest run                   # ~418+ tests pass

# Verify Step 18 + Step 19 wiring intact (parallel session sometimes reverts)
grep -c "tokenRetention" src/core/IBenchmark.ts                                      # ≥ 2
grep -c "computeTokenRetention" src/benchmarks/longmemeval/LongMemEvalS.ts          # ≥ 2
grep -c "retention-instrumentation" src/core/BenchmarkRunner.ts                     # 1
grep -c "CONDITIONAL_VERBATIM_CITATION" src/observational-memory/prompts.ts         # ≥ 2
grep -c "VERBATIM_CITATION_ELIGIBLE_CATEGORIES" src/observational-memory/runner.ts  # ≥ 1
grep -c "omRetrieverMs" src/core/BenchmarkRunner.ts                                  # ≥ 6
grep -c "om-retriever-ms" src/cli.ts                                                 # 3

# Verify Phase B v2 run JSON exists (the new Tier 2 v11 winner)
ls -la results/runs/2026-04-23T17-27-28-793--longmemeval-s--gpt-4o--full-cognitive--ingest.json
```

**If ANY check fails, stop and report drift before new LLM-cost work.**

### API key gotcha

This session burned ~30 minutes on a key conflict. The user's "new" key paste was byte-identical to an old key in the env files. The actual replacement only worked when I overwrote `sk-proj-Zon6EiNh...` (which was in env files at fresh-session start) with `sk-proj-F26yFdOW...` (which the user kept sending). Both keys verified working via curl 200 OK against `api.openai.com/v1/models`. Anthropic key was rotated to `sk-ant-api03-LN_fW0lg4...` in all 3 env files.

If next session sees auth errors, check `grep "^OPENAI_API_KEY" apps/wilds-ai/.env` — should start with `sk-proj-F26yFdOW`. If it starts with `sk-proj-Zon6EiNh`, the env file got reverted and needs re-update.

---

## 7. Constraints (CLAUDE.md, must obey)

- master branch only, never main
- --no-verify on all monorepo commits (secretlint)
- no em dashes in commits or docs
- no AI / Claude / Opus / rewrite mentions in commit messages
- no Co-Authored-By lines
- no subagents
- no git worktrees with submodules
- no git stash / reset / restore (other sessions active)
- commits ONLY when user explicitly asks
- agentos-bench is internal/on-demand
- wilds-ai is NOT a submodule in this monorepo (stage explicit files)
- paracosm IS a submodule
- all env files (.env, .env.local, .env.production) tracked
- re-read specs/plans END-TO-END at MAXIMUM REASONING before any implementation
- use deep-research / deep-write skills for web research
- use coderabbit:review on every implementation before commit
- always cd packages/agentos-bench/ before any bench command
- always source apps/wilds-ai/.env before any LLM-cost bench command
- per-correctness gap < +0.6 → don't fire reader-side variant
- retriever-side variants need a mechanism story (not just a gap)

---

## 8. Use of superpowers (proactive invocation)

Per CLAUDE.md and user-global "1% rule":

- bug / test failure / unexpected behavior → systematic-debugging FIRST
- implementing any feature or bug-fix → test-driven-development (TDD)
- before claiming done → verification-before-completion
- creating features → brainstorming BEFORE code
- writing a plan or spec → writing-plans
- executing a plan → executing-plans
- before merging → requesting-code-review + coderabbit:review
- writing prose / docs / blog posts → deep-write

---

## 9. What's NEXT (if continuing the rollout)

### Highest-EV next swings (per handoff §5 of prior handoff, refreshed)

1. **Hindsight typed networks (~$400 + 1-2 weeks dev)** — 4 typed retrieval networks (event/temporal/entity/relationship) + multi-strategy fusion. Hindsight publishes 91.4% MS at gemini-3-pro. OpenAI-only might land ~80% MS at gpt-4o. **Highest possible architectural ceiling.** Step 19's NULL on simple retriever knobs reinforces that breakthrough MS gains need a fundamentally different retrieval architecture, which Hindsight is.

2. **Gemini observer parity test (~$230)** — swap gpt-4o observer for gemini-2.5-flash. Mastra's published 84.23% at gpt-4o uses this. Likely matches Mastra. Trade: accepts Gemini vendor dependency. Becomes Tier 2-Gemini opt-in.

3. **Tuned OM observer prompt with per-correctness-gap-validated targeting (~$30 Tier A)** — earlier session tried this naively and got Step 18 v1 RED. v2 metric refinement now tells us specifically that the OBSERVER stage is already 87-95% retention; marginal gains are limited there. Could add KU-specific verbatim-preservation examples to OBSERVER_EXTRACTION_INSTRUCTIONS for one more datapoint, but expected value is small.

4. **Step 18 v2 + Step 17 v3 (BM25 session scoring)** — Step 17 v1/v2 was RED (latency-bound). v3 with BM25 instead of embedder might fix Step 17's latency without adding the cross-session reading discipline Step 18 v2 added. Would need to be combined to test the full pipeline.

5. **LongMemEval-M / LongMemEval-L stress tests (~$200 / ~$2000)** — answers "does our pipeline scale to longer haystacks?" not "does it improve accuracy?". Out of scope for accuracy-improvement budget.

### Lowest-EV (don't pursue further)

- More Step 19 variants on canonical retriever — already 3 mechanisms NULL'd. The bottleneck is architectural.
- Step 18 v3 / v4 with broader eligible category sets — v3 with SSA already NULL'd (predicted by per-correctness gap < +0.6 rule).
- Phase B canonical-only retriever experiments — Tier A already NULL.

---

## 10. Documentation expectations for next session

If next session ladders Step 18 v2 v11 to LEADERBOARD + bench blog:

- Update [results/LEADERBOARD.md](../results/LEADERBOARD.md) — add Tier 2 v11 row (75.4% [71.6, 79.0] N=500, $0.436/correct, 14s avg).
- Update [docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md](blog/2026-04-20-agentos-memory-longmemeval-rollout.md) — add v11 to Progressive Enhancement Tiers table; update TL;DR if promoting v11; What's Next section.
- Update [docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md](ARCHITECTURE_DECISION_MATRIX_2026-04-23.md) — add v11 tier assignment.

If next session pursues Hindsight or Gemini, follow the standard pattern (spec → plan → execution → findings → umbrella → handoff).

---

## 11. Methodology recap (durable, applies to all next-session experiments)

Unchanged from prior handoff plus Step 18 v2 + Step 19 lessons:

### New: Per-correctness retention split as variant-ROI predictor

Before firing any prompt-tune variant:
- Required: gap ≥ +0.6 across ≥ 2 baseline architectures
- Step 18 v3 SSA-eligible ($6.03 wasted) + Step 19 retriever variants ($7.92 partially wasted) were the lessons.

### Existing kill ladder

- Tier A: any regression > 5pp weighted vs reference → STOP
- Phase A: < canonical + 5pp at point estimate OR McNemar p ≥ 0.05 → STOP
- Phase B: explicit user approval required ($120-150+ commit)

### New: Retriever-side experiments need both gap AND mechanism story

Step 19 had per-correctness gap on MS but NO validated mechanism for why a specific knob (K, BM25 weight, over-fetch) moves it. Three independent knobs all NULL'd. Future retriever experiments should articulate WHICH gold passages a knob would surface that the baseline doesn't, with evidence (e.g., manual inspection of a few cases).

---

## 12. Communication cadence for fresh session

Same as prior handoffs plus:

- **Before firing variant runs:** confirm per-correctness gap signal supports the hypothesis. If gap < +0.6, propose smaller-scope test or skip.
- **For retriever-side variants:** also articulate the specific mechanism (which passages a knob surfaces). Step 19's NULL was predictable.
- **API key updates:** after the user pastes a key, verify it works via direct curl BEFORE firing any LLM-cost run (Step 19 burned ~$0 because of dead key, but lesson stands).

---

## 13. Acknowledgments

Session 2026-04-23 day 4-5 landed:

- **Step 18 token-retention framework** — durable scientific contribution; predicts variant ROI before LLM spend
- **Step 18 v1 RED** ($32.52) — uniform reader verbatim rule failed on synthesis-required categories
- **Step 18 v2 metric refinement (per-correctness split)** — methodological win
- **Step 18 v2 conditional reader Phase A 78.4%** ($25.63) — first variant to pass kill gate
- **Step 18 v2 Phase B 75.4%** ($164.45) — confirmed at scale, ships as Tier 2 v11
- **Step 18 v3 NULL** ($6.03) — SSA-eligible; lesson on borderline gaps
- **Step 19 conditional retriever NULL** ($7.92) — 3 retriever knobs falsified; lesson on mechanism stories
- **5 new findings docs + 2 specs + 2 plans + 3 handoffs**

Cumulative: ~$275 spent of $1000+ approved budget. Headroom ~$725 for next session's pursuit (Hindsight, Gemini observer, or new architecture).

---

## 14. The full continuation prompt (paste into fresh session)

```
Continue the AgentOS LongMemEval-S rollout. Read the handoff at
packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md
end-to-end at maximum reasoning before any work.

CURRENT STATE (settled 2026-04-23 day 4-5):

Three production tiers ship:
- Tier 1 default: canonical Step 3 HybridRetriever — 73.2% [69.2%, 77.0%]
  on LongMemEval-S Phase B N=500. $0.021/correct, 98s avg.
- Tier 2 opt-in: Step 16c v10 dynamic router — 74.6% [70.8%, 78.4%]
  Phase B N=500. $0.327/correct, 12s avg.
- Tier 2 v11 opt-in (NEW this session): v10 + Step 18 v2 conditional
  reader (KU+SSU verbatim citation rule via OM reader path) — 75.4%
  [71.6%, 79.0%] Phase B N=500. $0.436/correct, 14s avg. +0.8pp v10
  at point estimate (within sampling noise; CIs overlap). +1.5pp on
  multi-session vs v10. +6.8pp on multi-session vs canonical.

Step 19 conditional retriever tuning for canonical's MS bottleneck:
NULL at Tier A. 3 mechanisms (K=30, BM25=0.7, overfetch=6.0) all
verified to apply override on 4/4 MS cases via metadata, but NONE
moved MS accuracy above 25% canonical baseline. Falsifies the
"+63pp opportunity" framing of canonical's MS rawToRetrieved 0.365 —
the gap is real but not knob-tunable.

35 cumulative experiments documented. Step 18 token-retention metric
with per-correctness split is the durable scientific contribution.

CUMULATIVE COST: ~$275 / $1000+ approved. Headroom ~$725.

NEXT-SESSION CANDIDATES (ranked by ROI):

1. Hindsight typed networks (~$400 + 1-2 weeks dev) — 4 typed
   retrieval networks (event/temporal/entity/relationship) +
   multi-strategy fusion. Highest possible MS ceiling. Step 19's
   NULL strongly motivates trying a fundamentally different
   retrieval architecture, not more knob-tuning on BM25+dense+RRF.
2. Gemini observer parity test (~$230) — swap gpt-4o for
   gemini-2.5-flash observer. Mastra's published 84.23% at gpt-4o
   reader uses this. Trade: Gemini vendor dependency.
3. Promote Tier 2 v11 to default (no LLM cost) — update LEADERBOARD,
   bench blog, architecture decision matrix. Honest framing required:
   +0.8pp v10 within noise, but +1.5pp MS at scale.
4. Cross-validation runs at different seeds — Phase B was seed=42;
   re-fire at seed=7 / seed=99 to estimate the +0.8pp sampling
   noise envelope. ~$330 per re-fire, expensive.
5. Phase A confirmation runs of v10 baseline (without Step 18 v2)
   to measure how much the +1.9pp Phase A → +0.8pp Phase B gap is
   explained by Phase A sampling luck. ~$25 each.

READ THESE FIRST AT MAX REASONING:

1. packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md
   — THIS handoff
2. packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md
   — full v1+v2+v3+Phase A+Phase B trajectory + per-correctness methodology
3. packages/agentos-bench/docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md
   — NULL on MS, mechanism diagnosis, durable plumbing
4. packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md §7
   — 35-variant scoreboard

PRE-FLIGHT CHECKLIST (handoff §6) IS MANDATORY. Catches:
- agentos IGMI patch + max_tokens clamp in dist
- 418+ tests pass (typecheck silent)
- Step 18 + Step 19 wiring intact (linter sometimes reverts)
- Phase B v2 run JSON exists at expected path

API KEY GOTCHA: this session burned 30+ min on byte-identical
key paste. Verify env files have `sk-proj-F26yFdOW...` not
`sk-proj-Zon6EiNh...`. Anthropic key is `sk-ant-api03-LN_fW0lg4...`.

DEFAULT FIRST ACTION:
After pre-flight passes, BRAINSTORM with user on which next swing.
Hindsight typed networks is the recommended high-EV path — Step 19
NULL'd retriever knobs, so breakthrough MS gains need a different
retrieval architecture. Gemini observer parity is the recommended
mid-EV path — likely matches Mastra's 84% with vendor trade.
Promoting v11 to LEADERBOARD requires no LLM but requires honest
framing of the within-noise nature of the +0.8pp aggregate lift.
```

---

## 15. Acknowledgments

Built on the Step 17 RED + Step 16c v10 Phase B + canonical foundation. Per-correctness retention split methodology generalized from Robertson 2003 and Karpukhin et al. (DPR, 2020). Test suite (418+) caught reverts from parallel-session linter activity multiple times this session.

End of handoff.
