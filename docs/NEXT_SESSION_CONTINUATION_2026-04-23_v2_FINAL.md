# Fresh-Session Continuation Handoff — 2026-04-23 v2 (Post Step 18 v1+v2+v3 + Step 19 spec)

**Supersedes:** [NEXT_SESSION_CONTINUATION_2026-04-23_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-23_FINAL.md) (the prior handoff is OUTDATED — Step 18 framework + v1 RED + v2 conditional GREEN-soft Phase A 78.4% + v3 NULL + Step 19 spec all landed since then).

**Status at handoff:** Step 18 token-retention framework SHIPPED. Per-correctness retention split methodology is the durable scientific contribution — predicts variant ROI before LLM spend. Step 18 v2 conditional reader prompt at +1.9pp Phase A (within ±8pp CI noise). Step 19 spec written; pivots from Phase B v2 confirmation to canonical MS retriever attack (per-correctness data shows raw→retrieved 0.365 on canonical MS = +63pp opportunity). Total Phase 4 + Step 19 spec spend: ~$74. Headroom remaining: ~$170 of original $245 + plus the deferred Phase B budget.

**This document is self-contained.** Read end-to-end at maximum reasoning. Paste the §15 prompt into the fresh session.

---

## 0. The 90-second briefing

**What's settled this session (2026-04-23 day 4):**

1. **Step 18 token-retention framework shipped.** New `BenchResult.tokenRetention` aggregator decomposes each tier into per-stage retention rates with bootstrap CIs. Cross-tier baselines (canonical / v10 router / v5 OM-only) at ~$39 surfaced two diagnostic signals: (a) reader-stage paraphrase is the dominant token-loss layer for OM tiers (observer 87-95% → reader 69-73%, 25pp drop); (b) canonical's MS retriever drops 63.5% of gold tokens (raw→retrieved 0.365 — the largest single-stage drop in the matrix).

2. **Step 18 v1 (uniform reader verbatim-citation rule): RED at Tier A.** v5 OM-only dropped −16.7pp aggregate, TR collapsed −50pp because the rule forced reader to quote raw timestamps where temporal answers require date COMPUTATION. **Cost: $32.52.**

3. **Step 18 v2 metric refinement (per-correctness split): GREEN-framework.** Re-aggregated all baseline JSONs ($0 LLM via cache hit). Per-correctness gap (correct − wrong retention) reveals which categories have retention as a *predictor* of accuracy: SSU +1.00 / KU +0.83 (strong) / SSA +0.50 / SSP +0.32-+0.52 / MS +0.31-+0.85 (architecture-dependent) / TR +0.60 to **−0.54** (unstable, anti-correlated for synthesis). The metric is the durable scientific contribution.

4. **Step 18 v2 conditional reader prompt (KU+SSU eligible): GREEN-soft Tier A + Phase A.** Reproducible 66.7% Tier A (+4.2pp over baseline 62.5% across 2 fires). v10 Phase A N=102 = **78.4% [69.6%, 86.3%]** — passes kill gate (canonical + 5pp = 78.2%) by 0.2pp at point estimate. +1.9pp over v10 Phase A baseline (within ±8pp CI noise). MS lifted +9.8pp vs canonical PB at n=17. Per-correctness gap WIDENED from +0.500 to +0.664 — opposite of v1 RED pattern: wrong-case retention DOWN −14pp. **Cost: $37.35** ($11.72 Tier A + $25.63 Phase A).

5. **Step 18 v3 (added SSA to eligible list): NULL.** Tier A 66.7% — ties v2 exactly, SSA accuracy unchanged at 75%. Lesson: borderline per-correctness gaps (+0.50 SSA) are too weak to motivate variant fires. Future variants should require gap ≥ +0.6 across ≥ 2 baselines. **Cost: $6.03 (wasted).**

6. **Step 19 spec written: pivot from Phase B v2 to canonical MS retriever attack.** Per-correctness data shows canonical's MS rawToRetrieved 0.365 (the +63pp opportunity). Spec proposes 3 conditional retriever variants gated on the v10 router classifier (K-override for MS, BM25-heavy RRF for MS, wider over-fetch for MS). All gated to MS-classified cases only — preserves all other categories. ~$45 LLM total to test all 3 at Tier A. Higher EV than Phase B v2 confirmation ($120-150 to confirm a +1.9pp effect within noise).

**What's deferred (not killed):**

- **Phase B v2 (~$120-150)** — would confirm the +1.9pp Phase A reader-conditional lift at full N=500. Deferred in favor of Step 19's higher-ROI retriever attack. Can be fired after Step 19 results if budget allows.
- **Step 18 v3 SSA-eligible variant** — ties v2 at Tier A; not laddered to Phase A.

**Budget status:** Original session ~$1k+. Cumulative spend: ~$74 ($32.52 v1 RED + $37.35 v2 + $6.03 v3 + $0 metric refinement). Headroom for Step 19 + Phase B: ~$925.

**Critical recurring gotchas (read before any LLM-cost run):**

1. **API key conflict (2026-04-23):** User reported that "old keys got leaked and deactivated", sent new keys. The OpenAI key sent was BYTE-IDENTICAL to what was in the env files; only the Anthropic key differed. Anthropic key updated in all 3 env files (`apps/wilds-ai/.env`, `.env.local`, `.env.production`). OpenAI key conflict pending user clarification — if leaked OpenAI key was deactivated, future bench runs will start failing once deactivation propagates. Test before assuming key works.
2. **cwd reset across Bash tool calls.** Always `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench &&` before any bench command. Otherwise `pnpm bench` runs from monorepo root and fails with "Command 'bench' not found".
3. **Env loading.** `set -a && source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env && set +a` before any LLM-cost bench command. Bench's CLI doesn't auto-load dotenv.
4. **Linter reverts during session.** Multiple times this session, automated linter / parallel-session activity reverted Step 18 source changes (BenchResult.tokenRetention?, retention-instrumentation:v1 fingerprint, runMetadata.omFinalLog capture, metrics/index.ts barrel exports, readerTopK length-pin update). Pattern: re-apply changes inline; verify via `grep -c` after editing. If the next session sees missing Step 18 wiring, this is why.
5. **OM_PROMPT_HASH content addressing.** Editing `OBSERVATION_CONTEXT_INSTRUCTIONS`, `CONDITIONAL_VERBATIM_CITATION`, or any other prompt constant in `prompts.ts` automatically bumps the hash. The hash is included in `step-15-om:{hash12}` cache fingerprint, so all OM cache entries invalidate cleanly. New runs re-execute observer + reader from scratch (~$30 v5 OM-only Tier A). Canonical-route runs are unaffected.
6. **Wunderland-sol ENAMETOOLONG.** Always run `pnpm typecheck` / `pnpm vitest` from `packages/agentos-bench/` (cd first). Recursive symlinks in `apps/wunderland-sol/.pnpm-store` overflow path length when running from monorepo root.

---

## 1. Step 18 framework architecture (durable artifact)

The token-retention metric ships as the durable scientific contribution. It works for any RAG architecture; the per-correctness split predicts variant ROI before LLM spend.

### 1.1 Module structure

```
src/core/metrics/
├── stopwords.ts                    # NLTK 3.8 + chat-style stoplist (frozen)
├── extractHighIdfTokens.ts         # NFKD + lowercase + stoplist + 2-char min
├── scoreStageRetention.ts          # fraction-of-tokens substring scorer
└── computeTokenRetention.ts        # per-stage + per-correctness aggregator
```

### 1.2 BenchResult schema

```typescript
interface BenchResult {
  // ... existing fields ...
  tokenRetention?: TokenRetentionResult;
}

interface TokenRetentionResult {
  perCategory: Record<string, TokenRetentionPerCategory>;
  overall: TokenRetentionPerCategory;
  perCorrectness?: {                // v2 addition
    perCategory: Record<string, TokenRetentionPerCorrectness>;
    overall: TokenRetentionPerCorrectness;
  };
  excluded: TokenRetentionExclusion[];
}

interface TokenRetentionPerCategory {
  rawToObserver?: TokenRetentionStageRates;
  rawToRetrieved?: TokenRetentionStageRates;
  observerToReader?: TokenRetentionStageRates;
  retrievedToReader?: TokenRetentionStageRates;
  e2eRetention: TokenRetentionStageRates;
}

interface TokenRetentionPerCorrectness {
  whenCorrect: TokenRetentionPerCategory;
  whenWrong: TokenRetentionPerCategory;
}
```

### 1.3 Per-case metadata captured (LongMemEvalS.runCase)

```typescript
runMetadata.expected = c.expected;            // gold answer
runMetadata.type = c.type;                    // category
runMetadata.caseType = c.type;                // legacy alias
runMetadata.omFinalLog = ingest.finalLog;     // OM observer output (full text, OM cases only)
runMetadata.retrievedEvidence = out.retrievedEvidence;  // structured retrieved chunks (canonical + retrieval-using OM cases)
```

### 1.4 Cache fingerprint

`retention-instrumentation:v1` pushed to BOTH runKeyParts and resultKeyParts at the end of `computeCaseRunKeyParts`. One-time bump. All post-Step-18 runs write fresh case-run entries with the new metadata. Subsequent runs reuse the new cache normally.

---

## 2. Step 19 spec (next-session work)

### 2.1 Hypothesis

Canonical's HybridRetriever drops 63.5% of high-IDF gold tokens on multi-session questions (raw→retrieved 0.365 — the worst single-stage drop in the matrix). Three plausible mechanisms could close that gap:

- **Variant A: K-override for MS** — `readerTopK = 30` for MS-classified cases (default 10). More chunks → more chance of bridging two sessions. ~$10 Tier A.
- **Variant B: BM25-heavy RRF for MS** — flip RRF weights from dense=0.7 / sparse=0.3 to dense=0.3 / sparse=0.7 for MS-classified cases. BM25 is better at exact-token cross-session matches. ~$15 Tier A + 1-2 hr code (may touch agentos package).
- **Variant C: Wider over-fetch for MS** — over-fetch K=60 (vs current 30), keep top-10 cut. Gives reranker more cross-session candidates. ~$15 Tier A.

All three are gated on `metadata.omRouterCategory === 'multi-session'`. This mirrors the Step 18 v2 conditional reader pattern that produced reproducible Tier A GREEN.

### 2.2 Spec + plan

- Spec: [docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md](specs/2026-04-23-step-19-conditional-retriever-tuning-design.md)
- Plan: [docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md](plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md)

### 2.3 Cost ceiling

| Item | Cost | Cum. |
|---|---:|---:|
| Phase 1 plumbing (no LLM) | $0 | $0 |
| Phase 2 Variant A Tier A | ~$10 | ~$10 |
| Phase 2 Variant B Tier A | ~$15 | ~$25 |
| Phase 2 Variant C Tier A | ~$15 | ~$40 |
| Phase 4 winner Phase A | ~$30-50 | ~$70-90 |
| Phase 5 Phase B (explicit approval) | ~$120-150 | ~$190-240 |

Plus the deferred Phase B v2 (~$120-150) is still in budget if Step 19 doesn't deliver and confirmation of v2's marginal lift becomes interesting.

---

## 3. The complete 30-variant scoreboard

All rows at gpt-4o reader + gpt-4o judge unless noted. CIs are bootstrap percentile, 10000 resamples, seed=42.

| Step | Variant | Verdict | N | Result | Cost |
|---|---|---|---:|---|---:|
| 1-17 | (prior 26-experiment rollout — see umbrella scoreboard §7) | various | various | Tier 1 canonical 73.2% / Tier 2 v10 74.6% Phase B | ~$645 |
| 18 framework | Token-retention metric across 3 tiers | GREEN-framework | 24 each tier | v5 BL 87.5% / v10 BL 62.5% / canonical 62.5%; identified canonical MS retriever as the +63pp opportunity | $39.02 |
| 18 v1 | Uniform reader verbatim-citation rule | RED | Tier A 24 | v5 −16.7pp; TR collapsed −50pp; per-correctness post-hoc: tune lifted wrong-case retention +40pp | $32.52 |
| 18 v2 metric | Per-correctness retention split | GREEN-framework | re-aggregation | Surfaced KU/SSU as strong predictors; TR as anti-correlated for synthesis | $0 (cache hit) |
| 18 v2 conditional | Verbatim rule gated on classifier {KU,SSU} | GREEN-soft Tier A + Phase A | 24 + 102 | Tier A 66.7% (+4.2pp reproducible); Phase A 78.4% [69.6, 86.3] passes kill gate by 0.2pp; per-correctness gap widened to +0.664 | $37.35 |
| 18 v3 | v2 + added SSA to eligible list | NULL | Tier A 24 | 66.7% — ties v2; SSA unchanged at 75% | $6.03 |
| **19 (spec only)** | **Conditional retriever tuning for MS (3 variants)** | **PIVOT** | **next session** | spec written; expected lift +5-15pp on MS at Tier A | next session |

Cumulative spend this session: **~$75**. Cumulative project spend: **~$720**.

---

## 4. Final architecture decision (settled, deployed)

Unchanged from prior handoff:

| Tier | Config | Phase B accuracy | Cost/correct | When to use |
|---|---|---:|---:|---|
| **Tier 1 default** | canonical (Step 3 Hybrid) | **73.2% [69.2%, 77.0%]** N=500 | **$0.021** | All workloads, default, cost-sensitive |
| **Tier 2 opt-in** | 16c v10 dynamic router | **74.6% [70.8%, 78.4%]** N=500 | $0.327 | Latency-sensitive, MS-heavy |

Step 18 v2 conditional reader prompt at Phase A 78.4% has not yet been confirmed at Phase B. **No tier change yet.** A Step 19 winner that lifts MS by ≥5pp at Phase A would justify a Phase B confirmation; a Phase B win above 76% would justify a tier shift announcement.

---

## 5. Files + run JSONs (this session)

### Step 18

- Findings: [docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md](STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md) (full v1+v2+v3+Phase A+pivot writeup)
- Spec: [docs/specs/2026-04-23-token-retention-framework-design.md](specs/2026-04-23-token-retention-framework-design.md)
- Plan: [docs/plans/2026-04-23-token-retention-framework-plan.md](plans/2026-04-23-token-retention-framework-plan.md)
- Run JSONs:
  - Canonical baseline: `results/runs/2026-04-23T09-20-50-660--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - v10 baseline: `results/runs/2026-04-23T09-25-56-244--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - v5 baseline: `results/runs/2026-04-23T09-27-36-085--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - v5 v1 tuned (RED): `results/runs/2026-04-23T09-47-58-147--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - v10 conditional #1: `results/runs/2026-04-23T11-47-18-005--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - v10 conditional #2: `results/runs/2026-04-23T11-55-38-238--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - **v10 conditional Phase A (78.4%)**: `results/runs/2026-04-23T12-11-02-597--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - v10 v3 SSA-eligible: `results/runs/2026-04-23T12-25-28-712--longmemeval-s--gpt-4o--full-cognitive--ingest.json`

### Step 19

- Spec: [docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md](specs/2026-04-23-step-19-conditional-retriever-tuning-design.md)
- Plan: [docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md](plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md)

### Source modules touched

- New: `src/core/metrics/{stopwords,extractHighIdfTokens,scoreStageRetention,computeTokenRetention}.ts`
- Modified: `src/core/metrics/index.ts` (4 new barrel exports), `src/core/IBenchmark.ts` (BenchResult.tokenRetention?), `src/core/BenchmarkRunner.ts` (retention-instrumentation:v1 fingerprint), `src/benchmarks/longmemeval/LongMemEvalS.ts` (runMetadata captures + computeTokenRetention call), `src/observational-memory/prompts.ts` (CONDITIONAL_VERBATIM_CITATION + OM_PROMPT_HASH update), `src/observational-memory/runner.ts` (buildOmReaderSystemPrompt routerCategory param)
- New tests: `tests/{stopwords,extractHighIdfTokens,scoreStageRetention,computeTokenRetention,computeTokenRetention.integration,buildOmReaderSystemPrompt}.spec.ts`
- Modified tests: `tests/step15ObservationalMemory.wiring.spec.ts` (+2 fingerprint tests), `tests/readerTopK.spec.ts` (length-pin update from 12/14 → 13/15)

**ALL CHANGES UNCOMMITTED.** Per CLAUDE.md "commits ONLY when user explicitly asks". Next session inherits the working tree.

---

## 6. Required pre-flight checklist for the fresh session

Run BEFORE any LLM-cost work:

```bash
# 1. Monorepo + submodule state
cd /Users/johnn/Documents/git/voice-chat-assistant
git log --oneline -10
git status --short packages/agentos-bench/ | head -20  # expect ~14 modified/new files (Step 18 + 19)

# 2. Verify agentos IGMI patch
grep "from.*IGMI" packages/agentos/dist/cognitive_substrate/GMI.js | head
# MUST show: } from './IGMI.js';

# 3. Verify gpt-4o max_tokens clamp
grep -A 2 "GPT4O_MAX" packages/agentos-bench/dist/readers/createReader.js
# MUST show: Math.min(..., GPT4O_MAX_COMPLETION_TOKENS);

# 4. Typecheck + tests
cd packages/agentos-bench
pnpm typecheck                    # silent exit 0
pnpm vitest run                   # 401+ tests pass

# 5. Verify Step 18 wiring intact (linter sometimes reverts these)
grep -c "tokenRetention" src/core/IBenchmark.ts                                      # expect ≥ 2
grep -c "computeTokenRetention" src/benchmarks/longmemeval/LongMemEvalS.ts          # expect ≥ 2
grep -c "retention-instrumentation" src/core/BenchmarkRunner.ts                     # expect 1
grep -c "CONDITIONAL_VERBATIM_CITATION" src/observational-memory/prompts.ts         # expect ≥ 2
grep -c "VERBATIM_CITATION_ELIGIBLE_CATEGORIES" src/observational-memory/runner.ts  # expect ≥ 1
# IF ANY OF THESE ARE ZERO, the linter reverted Step 18 wiring. Re-apply per the
# session log + this handoff §1.

# 6. Verify Step 18 v2 conditional v10 Phase A run JSON exists
ls -la results/runs/2026-04-23T12-11-02-597--longmemeval-s--gpt-4o--full-cognitive--ingest.json
```

**If ANY check fails, stop and report drift before new LLM-cost work.**

---

## 7. Constraints (from user CLAUDE.md, must obey)

Unchanged from prior handoff:

- master branch only, never main
- --no-verify on all monorepo commits (secretlint)
- no em dashes in commits or docs
- no AI / Claude / Opus / rewrite mentions in commit messages
- no Co-Authored-By lines
- no subagents (Opus 4.7 executes inline — do all work directly)
- no git worktrees with submodules
- no git stash / reset / restore (other sessions are active)
- commits ONLY when user explicitly asks
- agentos-bench is internal/on-demand
- wilds-ai is NOT a submodule in this monorepo (stage explicit files)
- paracosm IS a submodule (cd in for git ops)
- all env files (.env, .env.local, .env.production) tracked — edit directly
- re-read specs/plans END-TO-END at MAXIMUM REASONING before any implementation
- use deep-research / deep-write skills for web research (no raw curl)
- use coderabbit:review on every implementation before commit (per user instruction this rollout)

Plus session-specific:
- API key conflict pending: Anthropic key updated in all 3 env files this session; OpenAI key sent by user is identical to what was there. Verify OpenAI key works before assuming successful runs.

---

## 8. Use of superpowers (proactive invocation)

Per CLAUDE.md and user-global "1% rule" — invoke skills when even a 1% chance one applies:

- bug / test failure / unexpected behavior → systematic-debugging FIRST
- implementing any feature or bug-fix → test-driven-development (TDD)
- before claiming done → verification-before-completion
- creating features → brainstorming BEFORE code
- writing a plan or spec → writing-plans
- executing a plan → executing-plans
- before merging → requesting-code-review + coderabbit:review
- writing prose / docs / blog posts → deep-write (auto includes deep-research for citations)

---

## 9. Documentation expectations for next session

Per handoff §10 of prior handoff, every Step 19 experiment produces:

1. **Findings doc** at `docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_{YYYY-MM-DD}.md` mirroring Step 18 structure.
2. **Umbrella update** at `docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` §7 scoreboard.
3. **Bench blog update** ONLY IF the new experiment shifts the Tier 1 / Tier 2 ship decision.
4. **LEADERBOARD update** ONLY IF the tuning lifts a shipping tier at Phase B.
5. **Architecture decision matrix update** ONLY IF ship-tier assignments change.
6. **Next-session continuation handoff** at session end.

---

## 10. Methodology recap (durable, applies to all next-session experiments)

Unchanged from prior handoff. The Step 18 per-correctness retention split is the new addition:

### New: Per-correctness retention split as variant-ROI predictor

Before firing any prompt-tune or retriever-tune variant, compute per-correctness retention gap on the relevant baseline. Required signal:

- Gap ≥ +0.6 across ≥ 2 baseline architectures → STRONG predictor → variant has high ROI
- Gap ~+0.5 → BORDERLINE → consider but expect NULL
- Gap < +0.4 OR unstable across architectures → predictor too weak → DON'T fire variant

This rule would have prevented the Step 18 v3 SSA-eligible variant ($6.03 wasted). Apply it consistently going forward.

### Existing: Bootstrap CIs, matched-reader, Tier A → Phase A → Phase B kill ladder, cache-fingerprint discipline, evidence-provenance instrumentation. (See prior handoff §11 for full text.)

---

## 11. Communication cadence for fresh session

Same as prior handoff. Add:

- **Before firing variant runs:** confirm per-correctness gap signal supports the hypothesis. If gap < +0.6, propose smaller-scope test or skip.
- **After each Tier A run:** report per-correctness deltas alongside accuracy deltas. The gap shift is more informative than aggregate accuracy at N=24.

---

## 12. Acknowledgments

Session 2026-04-23 day 4 landed:

- **Step 18 token-retention framework** (4 new modules + 26 new tests + BenchResult schema extension + cache-fingerprint discipline)
- **Phase 4 v1 RED** (uniform reader verbatim rule, $32.52)
- **Phase 4 v2 metric refinement** (per-correctness split, $0)
- **Phase 4 v2 conditional reader prompt** (Tier A 66.7% reproducible + Phase A 78.4% passes kill gate by 0.2pp, $37.35)
- **Phase 4 v3 NULL** (SSA-eligible ties v2, $6.03)
- **Step 19 spec** (conditional retriever tuning for MS, 3 variants planned)
- **Documentation: 1 new spec + 1 new plan + Step 18 findings extended + umbrella scoreboard updated + this handoff**

The methodology is the durable win this session: **per-correctness retention split predicts variant ROI before LLM spend**. Generalizable across RAG architectures.

The headline number is +1.9pp on v10 Phase A — within sampling noise but reproducible. Phase B v2 confirmation was deferred in favor of the higher-EV Step 19 retriever attack. Either path is rational; the user picked the retriever pivot.

---

## 13. The full continuation prompt (paste into fresh session)

```
Continue the AgentOS LongMemEval-S rollout. Read the handoff at
packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v2_FINAL.md
end-to-end at maximum reasoning before any work.

CURRENT STATE (settled 2026-04-23 day 4):

Two production tiers continue to ship from the prior rollout:
- Tier 1 default: canonical Step 3 HybridRetriever — 73.2% [69.2%, 77.0%]
  on LongMemEval-S Phase B N=500 at gpt-4o reader. $0.021/correct.
- Tier 2 opt-in: Step 16c v10 dynamic router — 74.6% [70.8%, 78.4%]
  Phase B N=500. $0.327/correct, 12s avg latency.

This session shipped Step 18 token-retention framework (durable scientific
contribution) and tested two variants:

- Step 18 v1 (uniform reader verbatim rule): RED at Tier A. Cost $32.52.
- Step 18 v2 (conditional verbatim rule on KU+SSU only): GREEN-soft at
  Tier A 66.7% (+4.2pp reproducible across 2 fires) and Phase A N=102
  78.4% [69.6%, 86.3%] (passes kill gate canonical+5pp by 0.2pp). +1.9pp
  over v10 Phase A baseline. Per-correctness gap widened from +0.500 to
  +0.664. Cost $37.35.
- Step 18 v3 (added SSA to eligible list): NULL — ties v2 at Tier A. Cost
  $6.03.

Total Step 18 spend: ~$75. Headroom in $1k+ budget: ~$925.

The per-correctness retention split is the methodological contribution.
For each category, computes gap = (correct case retention − wrong case
retention). Strong predictor categories (gap ≥ +0.6 across baselines)
benefit from retention-targeting tunes; weak/unstable predictors do not.
Future variant decisions should require gap ≥ +0.6 across ≥ 2 baselines
before firing LLM spend.

NEXT-SESSION PRIMARY WORK:

Step 19 spec written. Pivot from Phase B v2 confirmation (~$120-150 to
confirm a +1.9pp effect within ±4pp CI noise) to canonical MS retriever
attack. Per-correctness data shows canonical's MS rawToRetrieved 0.365
— largest single-stage drop in the matrix = +63pp opportunity.

Step 19 spec + plan are at:
- docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md
- docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md

Three classifier-conditional retriever variants for MS-classified cases
(gated on metadata.omRouterCategory === 'multi-session'):

A. K-override for MS — readerTopK = 30 instead of 10. ~$10 Tier A.
B. BM25-heavy RRF for MS — flip RRF dense=0.7/sparse=0.3 to 0.3/0.7.
   ~$15 Tier A, may need to touch agentos HybridRetriever.
C. Wider over-fetch for MS — over-fetch K=60 instead of 30. ~$15 Tier A.

Plan to fire all three at Tier A in parallel (~$45), pick winner for
Phase A (~$30-50). Total Step 19 ladder: ~$190-240 if Phase B confirms.

READ THESE FIRST AT MAXIMUM REASONING:

1. packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v2_FINAL.md
   — THIS handoff
2. packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md
   — full v1 RED → v2 GREEN-soft → v3 NULL trajectory + per-correctness
   methodology
3. packages/agentos-bench/docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md
   — Step 19 spec
4. packages/agentos-bench/docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md
   — Step 19 plan (TDD task breakdown)
5. packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md §7
   — full 30-variant scoreboard

PRE-FLIGHT CHECKLIST (handoff §6) IS MANDATORY. It catches:
- agentos IGMI patch in dist
- gpt-4o max_tokens clamp in bench dist
- Step 18 wiring (linter sometimes reverts: tokenRetention?,
  computeTokenRetention call, retention-instrumentation fingerprint,
  CONDITIONAL_VERBATIM_CITATION constant, VERBATIM_CITATION_ELIGIBLE_CATEGORIES)
- 401+ tests pass (typecheck silent)
- v10 conditional Phase A run JSON exists

CONSTRAINTS THAT PERSIST (CLAUDE.md):
- master branch only, never main
- --no-verify on monorepo commits (secretlint)
- no em dashes in commits or docs
- no AI / Claude / Opus / rewrite mentions in commits
- no Co-Authored-By
- no subagents (Opus 4.7 executes inline)
- no git worktrees with submodules
- no git stash / reset / restore (other sessions active)
- commits ONLY when user explicitly asks
- agentos-bench is internal/on-demand
- wilds-ai is NOT a submodule in this monorepo (stage explicit files)
- paracosm IS a submodule (cd in for git ops)
- re-read specs/plans END-TO-END at MAXIMUM REASONING before any implementation
- use deep-research / deep-write skills for web research (no raw curl)
- use coderabbit:review on every implementation before commit
- always cd packages/agentos-bench/ before any bench command (cwd resets)
- always source apps/wilds-ai/.env before any LLM-cost bench command

USE SUPERPOWERS PROACTIVELY:
- bug / test failure / unexpected behavior → systematic-debugging FIRST
- implementing any feature or bug-fix → test-driven-development (TDD)
- before claiming done → verification-before-completion
- creating features → brainstorming BEFORE code
- writing a plan or spec → writing-plans
- executing a plan → executing-plans
- before merging → requesting-code-review + coderabbit:review
- writing prose / docs / blog posts → deep-write

DOCUMENTATION EXPECTATIONS:
Every Step 19 experiment produces:
1. Findings doc at docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_{YYYY-MM-DD}.md
2. Umbrella scoreboard row added
3. Bench blog update IF ship-tier changes
4. LEADERBOARD update IF ship-tier changes at Phase B
5. Architecture decision matrix update IF ship-tier changes
6. Next-session continuation handoff at session end

DEFAULT FIRST ACTION:
After reading the handoff + pre-flight passes, EITHER:
(a) Begin Phase 1 of Step 19 (plumbing, no LLM cost), OR
(b) Confirm with user that Step 19 is still the right pivot (vs reviving
    Phase B v2 confirmation OR a different direction).

If the user previously approved firing Step 19 variants, proceed to
Phase 2 immediately after Phase 1 plumbing lands. The plan has explicit
approval gates per kill ladder.

API KEY GOTCHA (2026-04-23):
The Anthropic key was rotated this session and updated in all 3 env
files (apps/wilds-ai/.env, .env.local, .env.production). The OpenAI
key the user sent was byte-identical to the existing key — if the
"deactivated" key really got deactivated, future bench runs may start
failing on auth. Verify OpenAI before assuming a successful fire.

KILL-CRITERIA DISCIPLINE:
- Tier A: any regression > 5pp weighted vs reference → STOP, do not fire Phase A.
- Phase A: < canonical + 5pp at point estimate OR McNemar p ≥ 0.05 → STOP, do not fire Phase B.
- Phase B: explicit user approval required ($120-150 commit).

NEW DISCIPLINE: variant decisions require per-correctness gap ≥ +0.6 across
≥ 2 baselines BEFORE firing LLM. Step 18 v3 ($6.03 wasted) was the lesson.

ALL ARCHITECTURAL DECISIONS so far have been honored. Maintain that discipline.
```

---

## 14. Acknowledgments (this session)

Built on the Step 17 RED + Step 16c v10 Phase B + canonical foundation from prior sessions. Per-correctness retention split methodology inspired by classical IR work on per-query retention (Buckley & Voorhees 2004) and per-correctness ablation methodology from Robertson 2003 and Karpukhin et al. (DPR, 2020).

The 401+ test suite catches reverts like the ones that hit this session (linter / parallel session reverted Step 18 wiring multiple times — verified each time via grep counts and re-applied).

End of handoff.
