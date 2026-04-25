---
title: Next-Session Handoff — 2026-04-25 v2 (Post-SOTA-Research)
supersedes: NEXT_SESSION_2026-04-25_HANDOFF.md
research_anchor: SOTA_CITED_EVIDENCE_2026-04-25.md
---

# Next-Session Handoff — 2026-04-25 v2 (Post-SOTA-Research)

**Supersedes:** [NEXT_SESSION_2026-04-25_HANDOFF.md](NEXT_SESSION_2026-04-25_HANDOFF.md)

**Research anchor:** [SOTA_CITED_EVIDENCE_2026-04-25.md](SOTA_CITED_EVIDENCE_2026-04-25.md) — 23 primary-source-cited audits across all major SOTA libraries (Hindsight, Mem0 v3, Mastra OM, Anthropic Contextual Retrieval, Emergence, BEAM, ReasoningBank, Penfield audit, etc.).

**Status at handoff:** repo state is identical to v1 of this handoff (`agentos@425a9fc1`/codex-cleanup, `agentos-live-docs@3223135`, monorepo `c9651e9a8`/this-doc). 163/163 router-family tests + 513/513 bench tests still GREEN. **No experiments run this session — research only.**

**What changed in v2:** three substantive corrections to the v1 experiment plan and two NEW experiment families. Read v1's §0-§3 for context that didn't change; this doc supersedes §1 (the experiment plan) and §5 (the inspirations).

---

## 0. Three corrections to v1

These come from primary-source verification done 2026-04-25 — see SOTA_CITED_EVIDENCE_2026-04-25.md §12 for full citations.

### 0.1 Hindsight schema — four typed networks, not three

The v1 handoff's Stage E (§1.1) referenced an "entity/relation/episode network observer." **The actual Hindsight architecture is four typed networks**:

- **𝒲 World** (objective external facts)
- **ℬ Experience** (first-person biographical)
- **𝒪 Opinion** — `(text, confidence ∈[0,1], timestamp)` — the differentiating mechanism
- **𝒮 Observation** (preference-neutral entity summaries)

Source: arxiv.org/html/2512.12818v1 §3 (Equations 1, 12, 24).

Plus four-way RRF fusion: `{semantic, BM25, graph spreading activation, temporal interval overlap}` with k=60. Six-step extraction pipeline at ingest: coreference resolution → temporal normalization → participant attribution → reasoning preservation → fact-type classification → entity extraction.

**Stage E scope upgrade:** 1-2 weeks → **2-3 weeks**. $400-600 → **$500-800**. Bigger lift than the v1 spec assumed.

**Vendor-bias caveat that must be footnoted on any AgentOS-vs-Hindsight table:** Hindsight's 91.4% headline uses Gemini-3-pro reader; their open-source `vectorize-io/agent-memory-benchmark` uses a Gemini judge. The apples-to-apples comparable for our gpt-4o reader is **Hindsight OSS-20B 83.6% / OSS-120B 89.0%**, not 91.4%.

### 0.2 Mem0 v3 removed the graph store

The v1 handoff's Stage I (§1.3) listed "fact-graph retrieval (Mem0-style)" as a candidate. **Mem0 v3 explicitly removed graph store support in their OSS SDK** (docs.mem0.ai/migration/oss-v2-to-v3):

> *"Graph store support has been removed from the open-source SDK. It is replaced by built-in entity linking, which runs natively with no external dependencies."*

Mem0 v3 architecture is now:
- Single-pass ADD-only fact extraction (was: extract candidates + ADD/UPDATE/DELETE diff)
- Multi-signal hybrid search (semantic + BM25 + entity matching)
- Append-only memories; retrieval ranking handles staleness

Their headline 93.4% LongMemEval / 91.6% LOCOMO numbers come from their **managed platform** with "proprietary optimizations not available in the open-source SDK." Their own State-of-Memory-2026 article shows production Mem0 at **66.9% LOCOMO** (1.44s p95, ~1,800 tokens).

**Stage I pivot:** the planned "fact-graph executor" is no longer the right Mem0 baseline. **Recommended re-scoping:** implement Anthropic Contextual Retrieval `summarized` executor first (cheaper, smaller scope, +10-20pp expected on multi-session per Anthropic's own measurement), then if positive add entity-linking-aware hybrid retrieval as a 4th memory backend.

### 0.3 Calvin Ku's adaptive K average is 62.5, not 20

The v1 handoff's Stage H (§1.2) proposed "session-NDCG at K=20." Calvin Ku's reproduction critique of Emergence Simple Fast (medium.com/asymptotic-spaghetti-integration) found that the `top_k=42` magic number is benchmark-overfit; his **adaptive variant landing at average k=62.5** (via MMR + token-budget + nucleus selection) generalized better across LongMemEval/LOCOMO/MSC.

**Stage H broadened:** test K∈{20, 42, 62, 100} as a single Phase B sweep (~$240 vs the original ~$60). Each cell is independent and can run in parallel.

---

## 1. Mission (revised priority order)

Seven experiment families ranked by ROI per dollar after the corrections in §0. Costs are LLM budget; effort is calendar time.

| # | Stage | Cost | Effort | Expected outcome | Notes |
|---|---|---:|---|---|---|
| 1 | **L** | $475 | 3-5 days | +10-20pp on multi-session | **NEW** — Anthropic Contextual Retrieval `summarized` executor. Lowest hanging fruit. |
| 2 | **J** | $150 | 1 day | First-mover LongMemEval-M number | No vendor publishes M numbers prominently. |
| 3 | **H** | $240 | 1 day | Session-NDCG at K∈{20,42,62,100} | Cheap risk; broadened from $60. |
| 4 | **M** | $60 | 1 day | HEXACO modulation A/B (likely null) | **NEW** — fills published research gap. |
| 5 | **I** | $400 | 1 week | LOCOMO 51.5% → 60+% | Pivoted to entity-linking + Mem0-v3-style ADD-only. |
| 6 | **K** | $300 | 1 week | BEAM 100K + 500K + 1M | Skip 10M (Markmhendrickson 500K-degradation finding). |
| 7 | **E** | $500-800 | 2-3 weeks | Tier 3 max-acc → 78-80% | Upgraded scope: 4 typed networks + opinion evolution. |

**Total budget for full sweep: ~$2125-2425** (was ~$1300-1700 in v1 plan).

### 1.1 Stage L (NEW) — Anthropic Contextual Retrieval `summarized` executor

**Motivation:** `IngestRouter` ships `summarized` as a strategy ID with NO executor implementation. Anthropic published the exact recipe (Sep 2024) with verbatim prompts in their cookbook. Implementing it gives us a real `summarized` backend that consumers can use today, plus measured numbers on LongMemEval-S and LOCOMO.

**Implementation:**

1. New executor in `agentos-ext-grounding-guard` or a new `agentos-ext-summarized-memory`:
   - Per session/doc: one LLM summarize call (50-100 tokens output)
   - Per chunk: prepend session summary before embedding
2. Wire as `IngestRouter.dispatcher['summarized']`
3. Phase A N=102 + Phase B N=500 sweep on LongMemEval-S
4. Phase B N=1986 sweep on LOCOMO

**Cost breakdown:**
- LongMemEval-S ingest: $0.003/session × ~50 sessions × 500 cases = $75 one-time, cached forever
- LOCOMO ingest: $0.001/session × ~199 sessions × 1986 cases = $400 one-time, cached forever
- Phase B reader+judge: cached (no marginal cost)

**Expected:** +10-20pp on multi-session (per Anthropic's measurement: 35% retrieval failure reduction). At our current MS 54.9% baseline, that maps to ~62-66% — closer to OM-v11's 61.7% for free.

**Success criteria:** Phase B aggregate ≥ 78% on LongMemEval-S; LOCOMO Phase B ≥ 55%.

### 1.2 Stage J — LongMemEval-M (unchanged from v1)

LongMemEval-M is 1.5M tokens, 500 sessions per haystack — confirmed via xiaowu0162.github.io/long-mem-eval. **No vendor publishes prominent M numbers** (Mastra/Mem0/Supermemory all S-only). First-mover publication value is real.

**Cost:** ~$150 (longer haystacks = more reader tokens).
**Add:** run Stage G-LongMemEval-M judge FPR probe ($0.05) at the same time.
**Success:** Tier 3 min-cost preset preserves Pareto-dominance over Tier 1 / Tier 2b on M.

### 1.3 Stage H (broadened) — session-NDCG K-sweep

**Test:** K∈{20, 42, 62, 100} as four parallel Phase B sweeps on LongMemEval-S.
- K=20: matches our current canonical baseline
- K=42: Emergence Simple Fast magic number (Douglas Adams comment in code)
- K=62: Calvin Ku's adaptive average
- K=100: stress test for diminishing returns

**Cost:** ~$240 (4 × ~$60 each).
**Implementation effort:** 0 — flag already shipped (`--session-level-ndcg`, `--session-level-ndcg-top-k`).
**Success:** find the K that maximizes Phase B aggregate within CI of 76.6%.

### 1.4 Stage M (NEW) — HEXACO modulation A/B ablation

**Motivation:** AgentOS's `CognitiveMemoryManager` ships HEXACO-trait-modulated encoding bias. **No 2025-2026 paper validates that personality-modulated retrieval lifts agent-memory benchmark accuracy.** This is a publication gap.

**Implementation:**
- Run AgentOS Phase B on LongMemEval-S with `traits = neutral` (all 0.5) vs `traits = varied` (high openness or high conscientiousness, etc.)
- Hold all other config constant
- Compare aggregate + per-category accuracy

**Cost:** ~$60 (one Phase B with HEXACO ON, one with neutral; Phase B is ~$30 cached).
**Expected:** +0-2pp difference (likely null result on conversational facts; HEXACO matters more for emotional/narrative content)
**Publication value:** "honest test of cognitive-science grounding on agent memory benchmarks" — fills the academic gap. Publishable as honest negative regardless.

### 1.5 Stage I (pivoted) — LOCOMO architecture push

**v1 plan:** implement fact-graph executor based on Mem0-style triple extraction.

**v2 plan after Mem0 v3 disclosure:** implement two simpler architectures:

1. **Conversation-adaptive K** (easy, ship as `MemoryRouter` flag — already partially shipped via `--reader-top-k`)
2. **Entity-linking-aware hybrid retrieval** (mirrors Mem0 v3) — extract entities at ingest into a parallel `{collection}_entities` store; during retrieval rank by entity-overlap signal alongside semantic + BM25

**Cost:** ~$400 (Phase A N=102 + Phase B N=1986 LOCOMO sweep).
**Effort:** 1 week.
**Expected:** 51.5% → 55-60% on LOCOMO; the Mem0-v3-claimed 91.6% is likely managed-platform-only and not our reachable ceiling.

### 1.6 Stage K (tier-adjusted) — BEAM Phase A on 100K + 500K + 1M

**v1 plan:** BEAM Phase A on full 10M tier.

**v2 plan after Markmhendrickson 500K critique:** run Phase A on the **100K, 500K, and 1M tiers first** before splurging on 10M.

Markmhendrickson finding: *"State integrity degrades at 500K to 2M tokens. Roughly one-fifth to one-tenth the scale where retrieval architecture becomes critical."* Plus contradiction-resolution scores are "near zero at every tier, including 100K" per the BEAM paper itself — meaning the discriminating tiers may not be 10M.

**Cost:** ~$300 across three tiers.
**Effort:** 1 week (BEAM adapter implementation + three sweeps).
**Critical methodology decision:** BEAM uses **GPT-4.1-mini judge** (different from our gpt-4o-2024-08-06). Either (a) use BEAM's judge for direct comparability with Hindsight 64.1%, or (b) re-judge with our rubric and publish both columns with the FPR delta.

### 1.7 Stage E (scope-upgraded) — Hindsight typed-network observer

**v1 plan:** entity/relation/episode observer, 1-2 weeks, $400-600.

**v2 plan:** 4 typed networks (World/Experience/Opinion/Observation) + 6-step extraction pipeline + 4-way RRF fusion + opinion evolution mechanism.

**Cost:** $500-800.
**Effort:** 2-3 weeks.
**Expected:** Tier 3 max-acc breaks 78-80% on LongMemEval-S; min-cost stays 76.6%.
**Publication value:** comparable to Hindsight OSS-20B (83.6%) at our gpt-4o reader; a real architecture-level test.

---

## 2. Bench integration (deferred from v1, unchanged)

Same as v1 §2 — the bench-side `policyRouter.ts` migration to `@framers/agentos/memory-router` is still half-day code + ~$130 in re-runs (cache invalidates on backend-name change). Not a methodology improvement; defer until cost is acceptable.

---

## 3. Audit + eval improvements (unchanged from v1 §3)

Same as v1 §3:
- Historical run-JSON audit for Stage F-2-class flag drift (cheap, $0)
- Stage G-LongMemEval-M judge FPR probe ($0.05) — bundle with Stage J
- AdaptiveMemoryRouter validation on a non-LongMemEval workload ($50-100)
- Cross-vendor replication via Supermemory's bench (~4-6h + ~$80)

---

## 4. Blog updates

### 4.1 Update existing blog (2026-04-24-memory-benchmark-transparency-audit)

Add post-research section:
- Mem0 v3 graph-store removal (with quote + URL)
- Hindsight 4-network architecture (with arxiv citation)
- Vendor-bias footnote on cross-vendor comparison tables (Hindsight uses Gemini judge in their own bench; Mastra uses gemini-2.5-flash observer; Mem0's 93.4% is managed-platform-only)

### 4.2 New blog post candidates (post-experiments)

- **"What `--no-abstention` actually does (and doesn't)"** — already drafted in v1
- **"Implementing Anthropic Contextual Retrieval as an `IngestRouter` strategy"** — after Stage L lands
- **"HEXACO modulation on agent memory: an honest negative"** — after Stage M (likely null result)
- **"AgentOS on LongMemEval-M: first published number"** — after Stage J
- **"BEAM 100K through 1M: where retrieval architectures actually win"** — after Stage K

---

## 5. Inspirations to draw from (revised priority order)

Same five as v1 §5 but priority order changes after the corrections:

1. **Anthropic Contextual Retrieval** (Sep 2024) — Stage L primary source. Verbatim prompts at platform.claude.com/cookbook/capabilities-contextual-embeddings-guide. Verified $1.02/M with prompt caching.
2. **Mem0 v3 ADD-only architecture** (docs.mem0.ai/migration/oss-v2-to-v3) — Stage I primary source. Single-pass extraction + hybrid search + entity linking. Reference for 2026 production-realistic baseline.
3. **Mastra OM observer/reflector** (mastra.ai/research/observational-memory + traffic-light emoji compression) — Stage L could optionally use traffic-light tagging as an output format.
4. **Emergence AI Simple Fast + Calvin Ku critique** — Stage H K-sweep. github.com/EmergenceAI/emergence_simple_fast.
5. **Hindsight typed-network observer** — Stage E primary source. arxiv.org/html/2512.12818v1.

Removed from inspirations: ReasoningBank (Google Research, April 2026) — measured on WebArena/SWE-Bench, not LongMemEval/LOCOMO/BEAM. Different benchmark class.

---

## 6. Constraints (NON-NEGOTIABLE — same as v1)

Unchanged from v1 §6. Reproduced for fresh-session readers:

- **Git branch:** master, never main
- **Commits:** NEVER commit unless user explicitly asks
- **Push:** NEVER push unless user explicitly asks
- **Commit messages:** NEVER mention AI, Claude, Opus, rewrite, LLM. No "Co-Authored-By" lines
- **Monorepo commits:** Always `--no-verify` (secretlint blocks tracked .env files)
- **agentos / agentos-live-docs / paracosm are submodules**: cd into each, commit, push to its origin, update submodule pointer in monorepo
- **No subagents.** No worktrees with submodules. Never stash/reset/restore
- **Working dir for bench:** always `cd packages/agentos-bench` or absolute paths
- **No em dashes** in prose
- **No local builds** for wilds-ai. Postgres in production
- **Use `/deep-research` skill for web research.** Honest cost comparisons at matched reader
- **Lead with full recommendation.** Never menu without a decisive pick
- **Single-provider reproducibility:** classifier LLM is gpt-4o or gpt-5-mini. No Claude/Gemini deps for the shipping configuration
- **agentos-bench is benchmarks only.** Memory/RAG/retrieval improvements go in agentos core
- **No quick fixes / no specs without code.** Build the actual primitive; ship docs alongside

---

## 7. Pre-flight checklist (same as v1, plus one)

1. `git status -s` in monorepo + agentos submodule + agentos-live-docs submodule. Confirm clean
2. Run §11 verification commands from `SESSION_2026-04-24_FULL_AUDIT.md`. Confirm numbers match
3. Read [SESSION_2026-04-24_FULL_AUDIT.md](SESSION_2026-04-24_FULL_AUDIT.md) end-to-end at max reasoning before touching anything new
4. **NEW: Read [SOTA_CITED_EVIDENCE_2026-04-25.md](SOTA_CITED_EVIDENCE_2026-04-25.md) §12 for the corrected experiment plan and §13 for source URLs**
5. Pick an experiment family from §1 of THIS doc (not v1). Get explicit user approval before starting
6. For ANY new agentos primitive: TDD discipline. Write the failing contract test first. Ship the README alongside
7. For ANY benchmark sweep: invoke `superpowers:verification-before-completion`. Check `totalUsd > 0` and case-0 actualOutput differs from any prior cached run before claiming the run was fresh
8. Don't claim "verified" for anything the fresh session hasn't rebuilt + re-run

---

## 8. Methodology invariants (unchanged from v1 §8)

- Reader: `gpt-4o`, temperature 0, max tokens 256 reader / 1024 observer
- Judge: `gpt-4o-2024-08-06`, rubric 2026-04-18.1, empty system prompt
- Bootstrap: 10,000 resamples via Mulberry32, seed=42, 95% percentile CIs
- Per-case artifacts: every shipping number has a `results/runs/<timestamp>--...--ingest.json`
- Cost tracking: `totalUsd` = full-pipeline; `costPerCorrect` = totalUsd / passedCases
- Single-provider reproducibility: classifiers and judges all on OpenAI

---

## 9. FRESH-SESSION PROMPT (paste verbatim)

```
I'm continuing the AgentOS work from the 2026-04-24 cognitive-pipeline session.
Three docs to read end-to-end at max reasoning before touching anything:

  packages/agentos-bench/docs/SESSION_2026-04-24_FULL_AUDIT.md
  packages/agentos-bench/docs/NEXT_SESSION_2026-04-25_HANDOFF_v2_POST_SOTA_RESEARCH.md
  packages/agentos-bench/docs/SOTA_CITED_EVIDENCE_2026-04-25.md

The handoff v2 supersedes the v1 (which had three corrections after primary-source SOTA research).

Mission: push for higher accuracy metrics. Seven experiment families ranked by
ROI per dollar in §1. Recommended start: Stage L (Anthropic Contextual Retrieval
`summarized` executor, $475, 3-5 days, +10-20pp expected on multi-session) +
Stage J (LongMemEval-M, $150, first-mover publication).

Before taking any action:
1. `git status -s` in monorepo + both submodules. Confirm clean.
2. Run the verification commands in SESSION_2026-04-24_FULL_AUDIT.md §11.
3. Re-read §1 of the v2 handoff for the corrected experiment plan.
4. Get explicit user approval on which experiment family to run before spending
   any LLM budget.

Open decisions for the user:
- Which experiment family from v2 §1?
  Recommended: Stage L + Stage J in parallel (~$625 total, ~3-5 days).
  Stage E (Hindsight 4-network) is highest expected payoff but biggest scope ($500-800, 2-3 weeks).
- Bench integration of MemoryRouter? §2. Half-day code + ~$130 re-runs.
- Audit + eval improvements? §3. Cheap, $0-100 each.
- New blog drafts? §4. After experiments land.

Do NOT start new experiments without explicit approval. Start by reporting your
understanding of where things stand, then ask.
```

---

## 10. Closing claim — what makes our numbers trustworthy (extended)

Same as v1 §11. Reproduced and extended with one new bullet:

Our LongMemEval-S 76.6% and LOCOMO 51.5% K=20-tuned + 49.9% OOD all have:

- Bootstrap CI (10k resamples, seed=42)
- Hold-out validation on LongMemEval-S Tier 3 (min-cost routing 6/6 identical under 80/20 calibration)
- Judge FPR probe on LongMemEval-S (1%) and LOCOMO (0%, vs Penfield's 62.81% on LOCOMO's default judge)
- Matched-reader cross-vendor comparison (gpt-4o reader)
- Cost-per-correct accounting at real OpenAI invoices
- Per-case run artifacts at seed=42 (every case reproducible)
- Full ablation published, including the `--no-abstention` regression that contradicted our original headline
- Cache fingerprint invalidating on content change (post-fix)
- Self-caught publication correction with bug-fix commit + parameterized contract test
- Production primitive is what we measure: every leaderboard number is produced by `@framers/agentos/memory-router`
- Five canonical guide docs + architecture page section + blog post + READMEs anchor the orchestration story
- **NEW: cited-evidence audit of every competitor claim with primary-source URLs** — see [SOTA_CITED_EVIDENCE_2026-04-25.md](SOTA_CITED_EVIDENCE_2026-04-25.md). Our numbers are measured against the actual published architectures of Hindsight (4 typed networks, not 3), Mem0 v3 (single-pass ADD-only + hybrid, NOT graph), Mastra OM (gemini-2.5-flash observer + traffic-light emoji compression), and Anthropic Contextual Retrieval (verbatim prompts). No vendor claim is taken at face value without primary-source verification.

That last bullet is what most memory-benchmark publications skip. We don't.

---

End of handoff v2. Next session: read the audit + the v2 handoff + the SOTA evidence doc, ask, then act.
