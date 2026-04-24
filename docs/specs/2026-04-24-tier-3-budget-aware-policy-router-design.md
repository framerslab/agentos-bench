# Tier 3 Policy Router — Pareto-Optimal Per-Category Routing with Budget Envelope

**Date:** 2026-04-24
**Status:** Design v1; queued for implementation after user review.
**Supersedes:** None. New product feature layered on top of Tier 1 canonical + Tier 2a v10 router + Tier 2b v11 conditional-verbatim reader.
**Authoring context:** Authored from a fresh-context Opus 4.7 session after auditing the prior session's Phase B rollout. Initial Phase B data extraction appeared to show ~13x cost reduction, but post-review the figure corrected to 1.2x-4.8x depending on preset (full-pipeline cost basis, not the incorrectly-apples-and-oranges reader-only basis of the initial draft). This still reframes Tier 3 from the handoff's "budget-aware cost optimizer" framing into "Pareto-optimal per-category routing, with budget envelope as an optional overlay" — the architectural insight holds even after numerical correction. Budget approved up to $300+.

---

## 1. Summary

Add a per-query policy router to the bench that picks among `{tier_1_canonical, tier_2a_v10, tier_2b_v11}` based on:

1. **Predicted question category** (from the existing v10 `gpt-5-mini` fewshot classifier — $0.0005/query, already paid at Tier 2a/2b)
2. **A per-category routing table** derived from Phase B N=500 measurements (ships inside the spec)
3. **An optional budget envelope** (per-query USD ceiling; hard or soft exceed behavior)

The routing table is the load-bearing mechanism. Budget is an overlay. Three presets ship: `maximize-accuracy` (pick highest-accuracy backend per category), `minimize-cost` (pick Pareto-dominant-or-cheapest), and `balanced` (trade cost for latency on latency-sensitive categories).

**Headline estimate** (simulation over the three Phase B run JSONs, full-pipeline cost basis: `totalUsd / n_cases` per tier times route-mix, plus `$0.0005/query` classifier cost for Tier 1 routes):

| Preset | Realistic accuracy (v10 classifier) | $/correct | vs Tier 2b flat ($0.4362/correct) |
|---|---:|---:|---:|
| maximize-accuracy | **75.3%** | $0.357 | **1.22x cheaper** |
| balanced | 74.5% | $0.205 | **2.12x cheaper** |
| minimize-cost | 73.9% | $0.092 | **4.77x cheaper** |

Oracle ceilings (ground-truth category instead of classifier prediction): 76.2% / 76.0% / 76.0% at similar $/correct. The v10 fewshot classifier's **measured Phase B ground-truth accuracy is 55-60%** (277/498 on Tier 2a, 297/500 on Tier 2b) — the dominant misroute is MS→SSU (31-38 cases) and KU→SSU (33-34 cases). The 1-2pp oracle-vs-realistic gap across presets shows routing is surprisingly robust to classifier noise because many misroutes (e.g., KU→SSU) still pick an adequate backend for that question type.

**The headline pitch.** The `maximize-accuracy` preset reproduces Tier 2b's 75.4% aggregate at 1.2x lower cost-per-correct — a modest win driven by routing SSA to Tier 1 (where it Pareto-dominates at 89.3% vs 83.9%). The `minimize-cost` preset gives up 1.5pp to Tier 2b flat while costing 4.77x less — the real product story: mechanism-driven architectural cost optimization that routes high-cost OM backends only where they earn their keep (MS +6.8pp). **A prior draft of this spec claimed 13x cost reduction based on a cost-basis mismatch between `cases[].usd` (reader-only) and `totalUsd` (full pipeline). The corrected figures above use full-pipeline basis on both sides.**

Cost attribution caveat: the bench's `totalUsd` / `n_cases` average aggregates OM-route cases (~$1.29 each at Tier 2b) and canonical-route cases (~$0.028). Policy router simulations use this average per target tier. Phase A N=102 validation on a fresh fire measures the actual cost; the §7 estimates hedge both directions.

**Out-of-scope for v1**: per-tenant learning, custom routing-table JSON formats, LOCOMO / BEAM calibration, future Tier 4 two-call reader integration, workload-prior API from the handoff's §6.1.

---

## 2. Problem framing

Three shipped tiers offer three flat cost-accuracy points (full-pipeline cost, `totalUsd / n_cases`):

| Tier | Phase B N=500 | $/query (avg) | $/correct |
|---|---:|---:|---:|
| Tier 1 canonical | 73.2% [69.2, 77.0] | $0.0156 | $0.0213 |
| Tier 2a v10 router | 74.6% [70.8, 78.4] | $0.2436 | $0.3265 |
| Tier 2b v11 conditional verbatim | 75.4% [71.6, 79.0] | $0.3289 | $0.4362 |

**Per-case cost breakdown within Tier 2a / Tier 2b** (the internal v10 router sends KU+MS to OM, others to canonical-retrieve-then-read):

- OM-routed case: ~$1.29 (reader ~$0.042 + classifier $0.0005 + summarizer $0.001 + observer/reflector/synth ~$1.25)
- Canonical-routed case within Tier 2a/2b: ~$0.028 (reader ~$0.026 + classifier $0.0005 + summarizer $0.001)

Tier 2b's 120 OM cases × $1.29 + 380 canonical × $0.028 + overhead ≈ $164.84, matching `totalUsd` $164.45. This is why averaging `totalUsd / n_cases` as "per-case Tier 2b cost" and applying it uniformly over router-picked cases is an over-estimate when the router sends mostly canonical-route cases to Tier 2b — the honest headline in §1 uses this conservative averaging.

No tier Pareto-dominates across categories. Ground-truth per-category measurements at Phase B:

| Category | n | Tier 1 | Tier 2a | Tier 2b | Pareto winner |
|---|---:|---:|---:|---:|---|
| single-session-assistant | 56 | **89.3% @ $0.018** / 55s | 83.9% @ $0.020 / 6s | 83.9% @ $0.019 / 7s | Tier 1 dominates (acc + cost) |
| single-session-user | 69-70 | 97.1% @ $0.019 / 105s | 97.1% @ $0.021 / 8s | **98.6%** @ $0.021 / 7s | Tied acc; Tier 1 cheapest, Tier 2b +1.5pp at cheaper latency |
| temporal-reasoning | 131-133 | 70.2% @ $0.020 / 101s | **71.0%** @ $0.021 / 4s | 69.2% @ $0.021 / 5s | Tier 1 cheapest; Tier 2a +0.8pp at 25x latency drop |
| knowledge-update | 76-78 | 86.8% @ $0.019 / 83s | 85.9% @ $0.031 / 20s | **87.2%** @ $0.031 / 21s | Tier 2b narrowly; Tier 1 tied at 1/1.6x cost |
| multi-session | 133 | 54.9% @ $0.020 / 131s | 60.2% @ $0.031 / 21s | **61.7%** @ $0.034 / 27s | Tier 2b (+6.8pp architectural lift) |
| single-session-preference | 30 | 60.0% @ $0.021 / 58s | 60.0% @ $0.021 / 4s | **63.3%** @ $0.021 / 9s | Tier 2b dominates (acc at tied cost) |

A single-tier default over-pays for some categories (SSA flat tiered Tier 2 loses -5.4pp and costs +11%) and under-performs on others (Tier 1 on MS gives up 6.8pp vs Tier 2b). Pareto-optimal routing exploits these category-specific trade-offs without user-visible complexity.

---

## 3. Architecture

Four artifacts. One new module, one expanded module, one new CLI flag group, one new metadata key.

### 3.1 `src/core/policyRouter.ts` (new module)

Pure function. Given classifier output + routing table + budget envelope, returns backend selection + reasoning string.

```typescript
import type { QuestionCategory } from '../observational-memory/questionRouter.js';

export type PolicyBackend =
  | 'tier_1_canonical'
  | 'tier_2a_v10'
  | 'tier_2b_v11';

export type PolicyPreset = 'maximize-accuracy' | 'minimize-cost' | 'balanced';

export type BudgetMode = 'hard' | 'soft' | 'cheapest-fallback';

/**
 * Per-backend cost point used by the router. Cost is average $/query
 * measured at Phase B N=500 over all six categories; accuracy is the
 * per-category rate.
 */
export interface BackendCostPoint {
  backend: PolicyBackend;
  /** Average USD per query across all categories at this backend. */
  avgCostPerQuery: number;
  /** Per-category accuracy at this backend (Phase B N=500). */
  perCategoryAccuracy: Record<QuestionCategory, number>;
  /** Per-category USD per query at this backend (Phase B N=500). */
  perCategoryCostPerQuery: Record<QuestionCategory, number>;
  /** Per-category average latency in milliseconds at this backend. */
  perCategoryLatencyMs: Record<QuestionCategory, number>;
}

export interface RoutingTable {
  /** Maps predicted category → default backend under this preset. */
  defaultMapping: Record<QuestionCategory, PolicyBackend>;
  /** Human-readable preset name for metadata + logs. */
  preset: PolicyPreset;
}

export interface PolicyRouterDecision {
  predictedCategory: QuestionCategory;
  chosenBackend: PolicyBackend;
  chosenBackendReason: string;
  estimatedCostUsd: number;
  budgetCeiling: number | null;
  budgetExceeded: boolean;
  preset: PolicyPreset;
}

export interface PolicyRouterConfig {
  table: RoutingTable;
  /** Per-query budget envelope in USD. Null = unbounded. */
  budgetPerQuery: number | null;
  /** Behavior when the routing-table pick exceeds budget. */
  budgetMode: BudgetMode;
  /** Cost data for backends (used for budget-vs-cost comparison). */
  backendCosts: Record<PolicyBackend, BackendCostPoint>;
}

/**
 * Decide which backend to run for a given predicted category + budget.
 * Pure function, deterministic given inputs.
 */
export function selectBackend(args: {
  predictedCategory: QuestionCategory;
  config: PolicyRouterConfig;
}): PolicyRouterDecision;
```

Three preset tables ship as constants (see §4). Callers may pass a custom `RoutingTable` for experimentation; no on-disk JSON loader in v1.

### 3.2 `src/benchmarks/longmemeval/LongMemEvalS.ts` (extension)

Add a branch in `runCase` that fires when `ctx.config.policyRouter === true`. Reuses the existing `classifyQuestion` call at [`LongMemEvalS.ts:301`](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L301) (the `await classifyQuestion(...)` invocation line) — no new classifier dispatch — then calls `selectBackend` with the resolved routing table + budget envelope.

**Backend dispatch.** Tier 2a and Tier 2b share the same OM ingest and v10-scaffold reader pipeline. The only difference is whether the conditional verbatim rule fires at the reader prompt builder. Current `buildOmReaderSystemPrompt` at [`src/observational-memory/runner.ts:691-708`](../../src/observational-memory/runner.ts#L691) applies the rule ONLY when `routerCategory` is passed AND is in `VERBATIM_CITATION_ELIGIBLE_CATEGORIES`. No new config flag needed — the dispatcher just controls what it passes:

- `tier_1_canonical` → `useOmBranch = false`; classifier cost recorded as overhead (Tier 1 flat doesn't run classifier, so the policy router pays); fall through to canonical `runFullCognitiveCase` at [`LongMemEvalS.ts:635`](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L635).
- `tier_2a_v10` → `useOmBranch = true`; `effectiveScaffold = true` (use the v10 scaffold); pass `routerCategory: undefined` to `buildOmReaderSystemPrompt` so the verbatim rule does NOT fire; classifier cost already counted in the branch.
- `tier_2b_v11` → `useOmBranch = true`; `effectiveScaffold = true`; pass `routerCategory: {classifier output}` to `buildOmReaderSystemPrompt` so the verbatim rule fires on KU/SSU.

Downstream config overrides (`effectiveRetrieval`, `omGuidedRetrieval`) are forced to match the existing v10 router's behavior: retrieval OFF on OM routes, canonical runs alone on Tier 1 routes. Record the selected backend in `metadata.policyRouterDecision.chosenBackend` so post-run attribution can distinguish Tier 2a vs Tier 2b decisions.

**Interaction with existing `omDynamicRouter` flag.** Setting both `--policy-router` and `--om-dynamic-router` throws a `resolveRunConfig` validation error with a clear message. These are mutually exclusive dispatch strategies. Config resolution priority when both true: reject with exit code 2. (Silent precedence is a footgun.)

### 3.3 `CaseRun.metadata.policyRouterDecision` (new key)

Every case-run carries the decision for audit:

```typescript
metadata.policyRouterDecision?: PolicyRouterDecision;
```

Consumers (cost analysis, per-backend-hit-rate tabulation, classifier-misroute debugging) read from this key without a schema migration — `CaseRun.metadata` is already `Record<string, unknown>`.

### 3.4 `src/cli.ts` (flag additions)

```
--policy-router                            # enable Tier 3 routing
--policy-router-preset <preset>            # maximize-accuracy | minimize-cost | balanced
--policy-router-budget-per-query <USD>     # optional per-query ceiling
--policy-router-budget-mode <mode>         # hard (default) | soft | cheapest-fallback
```

Each flag validated at resolve time; invalid combinations throw a documented error. Example: setting `--policy-router-budget-mode soft` without `--policy-router-budget-per-query` throws.

### 3.5 `src/core/IBenchmark.ts` (RunConfig additions)

Four new optional fields added to `OPTIONAL_RUN_CONFIG_KEYS` tuple (single source of truth):

```typescript
// RunConfig additions:
/** Enable Tier 3 policy router. When true, dispatches per-query to tier_1/2a/2b based on classifier + routing table. Default: false. */
policyRouter?: boolean;
/** Preset for the routing table. Default: 'maximize-accuracy'. */
policyRouterPreset?: PolicyPreset;
/** Per-query USD ceiling. null = unbounded. */
policyRouterBudgetPerQuery?: number;
/** Behavior when routing-table pick exceeds budget. Default: 'hard'. */
policyRouterBudgetMode?: BudgetMode;
```

Corresponding entries added to `OPTIONAL_RUN_CONFIG_KEYS` so the `BenchContext.config` Omit/Pick types stay in lockstep.

### 3.6 Cache fingerprint

Append `policy-router:v1:<presetHash>` to `BenchmarkRunner.ts` `runKeyParts` and `resultKeyParts` **conditionally** — only when `config.policyRouter === true`. Follows the `step-16c-router:v2` conditional pattern at [`BenchmarkRunner.ts:487-510`](../../src/core/BenchmarkRunner.ts#L487), NOT the unconditional `retention-instrumentation:v1` pattern. Unconditional insertion would invalidate every existing cached run (including the Phase B cached runs this spec relies on for its cost-accuracy table) — that's unacceptable.

`presetHash` is a stable 8-hex-character hash of the routing table's JSON serialization (preset name + sorted category→backend mapping). Bump to `:v2` on any structural change to the decision algorithm; bump the preset table itself changes the `presetHash`, which automatically invalidates only runs with that specific preset.

```typescript
// Sketch in BenchmarkRunner.ts
if (config.policyRouter) {
  const presetHash = createHash('sha256')
    .update(JSON.stringify(resolvedRoutingTable, sortedKeys))
    .digest('hex')
    .slice(0, 8);
  runKeyParts.push(`policy-router:v1:${presetHash}`);
  resultKeyParts.push(`policy-router:v1:${presetHash}`);
}
```

---

## 4. Routing tables

Three preset tables derived from the Phase B cost-accuracy data in §2. Each is a frozen `Record<QuestionCategory, PolicyBackend>`.

### 4.1 `maximize-accuracy` (default preset)

Picks the highest-accuracy backend per category. Ties within CI noise broken by cost. Notes below each line indicate CI-overlap status.

```typescript
export const MAXIMIZE_ACCURACY_TABLE: RoutingTable = {
  preset: 'maximize-accuracy',
  defaultMapping: {
    'single-session-assistant': 'tier_1_canonical',   // 89.3% vs 83.9% / 83.9% — Pareto-dominant (acc + cost)
    'single-session-user': 'tier_2b_v11',             // 98.6% vs 97.1% / 97.1% — within CI [95.7,100] vs [92.8,100]; picked for acc
    'temporal-reasoning': 'tier_2a_v10',              // 71.0% vs 70.2% / 69.2% — within CI; picked for acc + latency drop
    'knowledge-update': 'tier_2b_v11',                // 87.2% vs 86.8% / 85.9% — within CI; picked for acc
    'multi-session': 'tier_2b_v11',                   // 61.7% vs 54.9% / 60.2% — +6.8pp real architectural lift (CI [53.4,69.9] vs [46.6,63.2])
    'single-session-preference': 'tier_2b_v11',       // 63.3% vs 60.0% / 60.0% — within CI at matched cost; picked for acc
  },
};
```

**Simulation result** (full-pipeline cost basis, Phase B run JSONs with v10 classifier predictions): **75.3% aggregate at $0.357/correct = 1.22x cheaper than Tier 2b flat**. Oracle ceiling: 76.2% at $0.356/correct. Three of six category picks (SSU, TR, KU) are CI-noise-plausible; the cache-fingerprint hash allows A/B-testing alternate picks without cache collisions.

### 4.2 `minimize-cost`

Picks the Pareto-dominant backend (strictly better or tied on both accuracy and cost) per category; falls back to cheapest at ties.

```typescript
export const MINIMIZE_COST_TABLE: RoutingTable = {
  preset: 'minimize-cost',
  defaultMapping: {
    'single-session-assistant': 'tier_1_canonical',   // Pareto-dominant (acc 89.3% vs 83.9%, cheaper)
    'single-session-user': 'tier_1_canonical',        // Tier 2b +1.5pp within CI; Tier 1 cheapest
    'temporal-reasoning': 'tier_1_canonical',         // within CI at all 3 tiers; cheapest wins
    'knowledge-update': 'tier_1_canonical',           // within CI of Tier 2b at ~1/20x full-pipeline cost
    'multi-session': 'tier_2b_v11',                   // +6.8pp real architectural lift
    'single-session-preference': 'tier_2b_v11',       // +3.3pp same Tier-2b internal-route cost ($0.028 each)
  },
};
```

**Simulation**: **73.9% aggregate at $0.092/correct = 4.77x cheaper than Tier 2b flat** (realistic v10 classifier). The 1.5pp accuracy drop vs `maximize-accuracy` at realistic-classifier comes from MS cases where the v10 classifier misroutes them to a non-MS bucket — those misrouted cases then land on Tier 1 (per this preset) and lose the +6.8pp MS architectural lift. Oracle (ground-truth routing): 76.0% at $0.157/correct — 2.78x cheaper than Tier 2b flat, **Pareto-dominating Tier 2b flat on both accuracy (76.0% vs 75.4%) AND cost**. The difference between realistic and oracle is entirely classifier quality.

### 4.3 `balanced`

Accepts up to 1.6x cost for latency improvements over 10x. Targets users who care about p95 response time.

```typescript
export const BALANCED_TABLE: RoutingTable = {
  preset: 'balanced',
  defaultMapping: {
    'single-session-assistant': 'tier_1_canonical',   // Pareto (acc + cost); 55s lat vs 6-7s is only slowdown
    'single-session-user': 'tier_1_canonical',        // tied acc; 105s lat vs 7-8s; SSU's long-session cost acceptable
    'temporal-reasoning': 'tier_2a_v10',              // 4s vs 101s @ within-CI acc, matched-cost Tier 1 vs 2a
    'knowledge-update': 'tier_2a_v10',                // 20s vs 83s at matched acc CI; Tier 2a is better "balanced" than Tier 2b here
    'multi-session': 'tier_2b_v11',                   // real +6.8pp architectural win justifies latency cost
    'single-session-preference': 'tier_2b_v11',       // +3.3pp at matched cost, 9s latency acceptable
  },
};
```

Note: Balanced routes KU to Tier 2a (not Tier 2b). Rationale: KU accuracy 86.8% Tier 1 / 85.9% Tier 2a / 87.2% Tier 2b are all within-CI; at matched OM cost ($0.031/query) and matched latency (20-21s), Tier 2a is indistinguishable from Tier 2b on the KU category. Tier 2b's marginal acc win is noise-plausible. "Balanced" prefers the simpler Tier 2a (no conditional verbatim prompt added).

**Simulation**: **74.5% aggregate at $0.205/correct = 2.12x cheaper than Tier 2b flat** (realistic). Oracle: 76.0% at $0.278/correct = 1.57x cheaper. Balanced trades 0.8pp accuracy vs maximize-accuracy for ~1.7x cost reduction.

---

## 5. Decision algorithm

Approach A (greedy max-EV under budget constraint) with a pre-A Pareto-dominance check. Pseudocode:

```
selectBackend(predictedCategory, config):
  # Classifier cost ($0.0005) is a sunk cost — the classifier has already
  # run before this function is called. Budget check concerns ONLY the
  # backend's per-query cost, not the classifier.

  1. Validate inputs:
     - predictedCategory must be in config.table.defaultMapping, else throw
       PolicyRouterUnknownCategoryError (classifier returned a value the
       table doesn't know how to route).

  2. Look up routing-table pick:  picked = config.table.defaultMapping[predictedCategory]
     backendCost = config.backendCosts[picked].perCategoryCostPerQuery[predictedCategory]

  3. Budget check:
     if config.budgetPerQuery is null:
       return decision(picked, reason="routing-table pick, no budget", cost=backendCost, exceeded=false)

     if backendCost <= config.budgetPerQuery:
       return decision(picked, reason="routing-table pick fits budget", cost=backendCost, exceeded=false)

  4. Budget exceeded:
     match config.budgetMode:
       'hard':
         throw PolicyRouterBudgetExceededError(
           `backend ${picked} cost $${backendCost} exceeds budget $${config.budgetPerQuery}`
         )

       'soft':
         # Exceed the per-query budget only if the routing-table pick is
         # more EFFICIENT per correct answer than the cheapest backend that
         # fits the budget. Both sides compared in USD/correct — dimensionally
         # consistent, no unit mixing.
         cheapestFits = cheapest backend b where backendCosts[b][category] <= budgetPerQuery
         if cheapestFits is null:
           # No backend fits budget; degrade to the globally cheapest backend.
           return decision(cheapestGlobally, reason="soft no-fit: picking absolute cheapest", exceeded=true)

         pickedAcc   = accuracy[picked][category]
         cheapestAcc = accuracy[cheapestFits][category]

         # Edge case: if picked has 0 accuracy on this category, NEVER exceed
         # budget for it (division by zero otherwise; +Inf compares unreliably).
         if pickedAcc == 0:
           return decision(cheapestFits, reason="soft budget downgrade: picked has 0 acc on category", ...)

         # Edge case: if cheapestFits has 0 accuracy, picked is trivially more
         # efficient IF it has non-zero accuracy (which the prior check guarantees).
         if cheapestAcc == 0:
           return decision(picked, reason="soft exceed: cheapest has 0 acc", exceeded=true)

         pickedCPC   = backendCost                                       / pickedAcc
         cheapestCPC = (backendCosts[cheapestFits][category])            / cheapestAcc
         if pickedCPC <= cheapestCPC:
           return decision(picked, reason="soft exceed: better $/correct", exceeded=true)
         else:
           return decision(cheapestFits, reason="soft budget downgrade: cheaper $/correct", exceeded=false)

       'cheapest-fallback':
         cheapestFits = cheapest backend within budget
         if cheapestFits is null:
           return decision(cheapestGlobally, reason="no backend fits budget; picking absolute cheapest", exceeded=true)
         return decision(cheapestFits, reason="budget downgrade", exceeded=false)
```

`soft` mode's efficiency check is dimensionally USD/correct on both sides. The heuristic: per-query ceilings ration compute, but a routing pick that produces more correct answers per dollar is still a win even when it exceeds the per-query ceiling. `hard` mode rations compute strictly (SaaS tenants with fixed per-call budgets); `cheapest-fallback` degrades gracefully (workloads prioritizing predictability). No threshold knob in v1 — the simpler CPC comparison is self-tuning.

---

## 6. Provenance

Every run produces per-case `metadata.policyRouterDecision` entries. Expected shape:

```json
{
  "predictedCategory": "multi-session",
  "groundTruthCategory": "multi-session",
  "chosenBackend": "tier_2b_v11",
  "chosenBackendReason": "routing-table pick fits budget",
  "estimatedCostUsd": 0.3289,
  "budgetCeiling": 0.10,
  "budgetExceeded": false,
  "preset": "maximize-accuracy"
}
```

`groundTruthCategory` is populated from `metadata.type` (the benchmark's GT category). Including it directly on the decision object lets a single run JSON compute classifier misroute rate and oracle counterfactuals without joining against the benchmark case data.

Post-run analysis reads from this key to compute:

- **Per-backend hit rate**: `sum(decisions where chosenBackend = X) / total`
- **Per-category backend mix**: cross-tab of predicted category × chosen backend
- **Classifier accuracy on this run**: `sum(decisions where predictedCategory == groundTruthCategory) / total`
- **Budget breach rate**: `sum(decisions where budgetExceeded) / total`
- **Oracle counterfactual estimate**: per §6's estimator (see below)

An aggregator helper `computePolicyRouterStats(cases)` lives at [`src/core/metrics/`](../../src/core/metrics/) and is called in `aggregate()` when any case has a `policyRouterDecision`. Output appended to `BenchResult` as:

```typescript
policyRouterStats?: {
  perBackendHitRate: Record<PolicyBackend, number>;
  perCategoryBackendMix: Record<QuestionCategory, Record<PolicyBackend, number>>;
  classifierAccuracyOnRun: number;  // predicted == groundTruth rate
  budgetBreachRate: number;
  avgCostPerQuery: number;
  /**
   * Oracle counterfactual ESTIMATE — the expected aggregate accuracy if the
   * policy router had oracle (ground-truth) category knowledge instead of
   * the classifier's prediction. Computed from the shipped per-category
   * accuracy table in §2 (NOT from live cross-tier outcomes in this run,
   * which would require per-case data for all backends).
   *
   * Use: quantify "how much does classifier quality bottleneck this preset?"
   * across runs without re-firing. For live per-case cross-tier measurement,
   * run the same dataset at each backend separately (Phase B ran this once).
   */
  oracleCounterfactualEstimate: {
    accuracy: number;       // weighted avg from §2 per-category × backend table
    costPerCorrect: number; // same basis
  };
};
```

The estimate is load-bearing for interpretability: it lets `--policy-router --preset maximize-accuracy` runs print "classifier accuracy 59%, aggregate 75.3%, oracle ceiling would be 76.2%" in one line of summary output. Cheap, offline, no new LLM cost.

---

## 7. Validation plan

The per-backend accuracies are already Phase B N=500. The policy router itself introduces no new ML components — only a routing decision over measured quantities. Validation focuses on plumbing correctness, realistic-classifier performance, and **full-pipeline cost reproduction**.

Cost estimates use the full-pipeline basis ($0.0156/q at Tier 1, $0.2436/q at Tier 2a, $0.3289/q at Tier 2b, weighted by each preset's route mix). These are upper bounds: simulations assume every case at Tier 2a/2b pays the average per-case cost (including OM ingest), even when the case would run canonical-only at that tier.

| Gate | N | Preset | Expected outcome | Est. cost (upper bound) | Kill criterion |
|---|---:|---|---|---:|---|
| **Tier A sanity** | 24 | maximize-accuracy | All routing decisions captured in metadata; per-backend mix matches simulation ±10pp; no crashes | ~$7 | Any crash, any missing metadata key, backend mix deviates >15pp |
| **Phase A maximize-accuracy** | 102 | maximize-accuracy | Aggregate ≥ 73.5% lower-CI ≥ 68%; $/correct in [$0.25, $0.45] | ~$28 | Aggregate < 72% OR $/correct > $0.50 |
| **Phase A minimize-cost** | 102 | minimize-cost | Aggregate ≥ 72% lower-CI ≥ 66%; $/correct in [$0.06, $0.16] | ~$8 | Aggregate < 70% OR $/correct > $0.25 |
| **Phase A balanced** (optional) | 102 | balanced | Aggregate ≥ 73%; $/correct in [$0.15, $0.30] | ~$18 | Aggregate < 71% OR $/correct > $0.35 |
| **Phase B maximize-accuracy** | 500 | maximize-accuracy | Aggregate ≥ 74% lower-CI ≥ 70%; $/correct in [$0.30, $0.42] | ~$136 | Aggregate < 73% OR $/correct > $0.50 |
| **Phase B minimize-cost** (optional) | 500 | minimize-cost | Aggregate ≥ 72% lower-CI ≥ 68%; $/correct ≤ $0.20 | ~$40 | Aggregate < 70% |

**Total validation cost (all six gates)**: ~$237 upper-bound. Budget approval $300+ covers this plus contingency for re-runs / classifier cache misses.

**Minimum validation path**: Tier A sanity + Phase A maximize-accuracy + Phase A minimize-cost = ~$43. This is the recommended minimum. Phase B maximize-accuracy is the shipping-gate (~$136). Phase B minimize-cost and Phase A balanced are optional.

**Honest uncertainty (two sources):**
1. **Classifier drift**: if the v10 classifier is re-fired (cache miss), the predicted category distribution may shift within its own noise band. Prior Phase B Tier 2a and Tier 2b runs had 55.6% and 59.4% classifier accuracy respectively (≈4pp internal variance). Phase A catches drift before Phase B.
2. **Cost-per-query attribution**: Simulations charge each tier's `totalUsd / n_cases` average to every routed case. The actual per-case cost at Tier 2a/2b varies by internal route (OM ~$1.29, canonical ~$0.028). Phase A settles the real number for each preset.

**Alternative validation path (faster, cheaper)**: Reuse the existing Phase B cached classifier outputs from `metadata.omRouterCategory` in the three shipped run JSONs, write the policy router on top as pure Python/TS, and compute all aggregate metrics offline. This validates **routing logic** perfectly but cannot validate **plumbing correctness** (metadata capture, CLI parsing, cache fingerprint behavior) — Tier A sanity at ~$7 is still required for those.

---

## 8. Risk + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Classifier accuracy drifts on fresh Phase B fire | Low-Medium | Policy router aggregate drops 1-3pp vs simulation | Tier A + Phase A gates catch before Phase B; `oracleCounterfactualEstimate` in run output quantifies the gap |
| Classifier already misroutes MS at 25-45% rate (measured) | Observed | MS accuracy drops on misrouted cases | `minimize-cost` preset is least affected (MS is the only OM-route category); add logprobs-based confidence threshold in v2 if production traffic shows worse behavior |
| `soft` budget mode degenerate case (both backends 0 acc) | Very low | Division-by-zero or +Inf comparison | Explicit edge-case handling in §5 pseudocode (zero-acc picked → degrade; zero-acc cheapest → exceed) |
| Custom routing table JSON parser drift | N/A in v1 | N/A | Out of scope; v1 hardcodes 3 preset tables only |
| Cache invalidation across runs with different presets | Medium | Cached runs from preset A could satisfy preset B queries | `policy-router:v1:<presetHash>` cache fingerprint tag (§3.6); each preset gets a unique 8-char hash |
| Routing to a backend whose internal route cost differs from `totalUsd/n` average | Medium | Actual cost drifts from simulation estimate by factor of 2-4x | Phase A gate measures real cost; spec documents the upper-bound assumption explicitly |
| `--policy-router` and `--om-dynamic-router` set simultaneously | Low | Silent precedence confusion | `resolveRunConfig` validates mutual exclusion, throws with exit code 2 |
| Per-category cost-accuracy numbers shift between agentos versions | Low | Routing table goes stale vs the dataset | `OM_PROMPT_HASH` in `retention-instrumentation:v1` fingerprint forces reruns on any OM-prompt edit; router table is explicitly calibrated for the Phase B 2026-04-23 codebase |

---

## 9. Open questions (for implementation discussion)

1. **Classifier confidence gate (v2)**: The v10 fewshot classifier outputs a single category token. OpenAI DOES expose token-level logprobs on chat completions since late 2023. A single-token category output carries a cheap confidence signal. v2 adds `--policy-router-min-confidence` (threshold below which an uncertain classification falls back to a safe default, e.g., the ground-truth-optimal backend for the predicted category's most-likely alternative). Measured Phase B misroute rates (25-45% depending on category) make this a likely-useful knob.

2. **Budget currency**: `--policy-router-budget-per-query` is per-query USD. Session-level budget (`--policy-router-budget-per-session`) would require stateful tracking across calls. Out of scope for bench v1; document as future work for production SDK integration.

3. **Prompt caching interaction**: When the same query hits the reader cache, the per-query cost is ~$0. The budget check still uses the routing table's `perCategoryCostPerQuery` average, which assumes cache-miss. Acceptable for v1; production SDK could integrate cache-hit probability.

4. **Per-tenant learning**: The routing table is frozen per run. Production usage might want to update the table from production traffic (e.g., per-tenant hit rates suggesting category-specific cost recalibration). v2 scope.

5. **Latency-preferring presets beyond `balanced`**: Users may want a `minimize-latency` preset that routes everything to Tier 2a (avoiding Tier 1's 100s avg). Not shipped in v1; document as future work.

6. **TR routing noise**: The ground-truth data shows Tier 2a TR at 71.0% vs Tier 1 at 70.2% — within CI noise. `minimize-cost` routes to Tier 1 (cheapest); `maximize-accuracy` routes to Tier 2a. `balanced` routes to Tier 2a for latency. The noise-band decision is documented but could flip on fresh data. Cache tag includes preset hash so Phase A re-fires don't silently satisfy cached decisions.

7. **Tier 2a separability from Tier 2b**: The current codebase has no flag to disable conditional verbatim. §3.2's dispatch-level fix (pass `routerCategory: undefined` for Tier 2a, actual category for Tier 2b) cleanly separates them without a new config flag. This relies on `buildOmReaderSystemPrompt`'s existing behavior (verbatim fires only when a routerCategory in `VERBATIM_CITATION_ELIGIBLE_CATEGORIES` is passed). If that function's signature changes, the dispatcher must update.

---

## 10. Out of scope for v1

- **Per-tenant learning / online routing-table updates** (v2 feature, requires stateful tracking)
- **Custom routing-table JSON parser** (v2; hardcode 3 presets for v1)
- **Future Tier 4 integration** (two-call reader; requires Tier 4 to exist first)
- **LOCOMO / BEAM adaptation** (requires per-benchmark recalibration of per-category cost-accuracy points). v1 is LongMemEval-S only — noted in §1 framing.
- **Confidence-gated classifier downgrades via logprobs** (v2 per §9.1; applicable once production traffic quantifies real misroute cost)
- **Session-level or monthly budget tracking** (v2; per-query only in v1). The handoff's §6.1 "workload prior" API is bundled here: workload-mix hints from the calling app require a stateful budget accumulator.
- **Latency SLA gates** (v2; budget-only in v1)

---

## 11. Success criteria

1. **Tier A sanity**: N=24 run at `maximize-accuracy` preset succeeds silently; every case has `metadata.policyRouterDecision` with all 8 fields populated (predicted + GT + backend + reason + cost + ceiling + exceeded + preset); per-backend mix within ±15pp of simulation.
2. **Phase A maximize-accuracy**: Aggregate ≥ 73.5% (lower CI ≥ 68%) at full-pipeline $/correct within [$0.25, $0.45].
3. **Phase A minimize-cost**: Aggregate ≥ 72% (lower CI ≥ 66%) at $/correct within [$0.06, $0.16].
4. **Phase B maximize-accuracy**: Aggregate ≥ 74% (lower CI ≥ 70%) at $/correct within [$0.30, $0.45].
5. **Post-run stats**: `policyRouterStats.oracleCounterfactualEstimate.accuracy` computed from the §2 table agrees with direct post-hoc simulation within ±1pp.
6. **Classifier-accuracy-on-run reporting**: `policyRouterStats.classifierAccuracyOnRun` present and falls within [50%, 65%] (matching measured Phase B range).

If criteria 1-4 fire GREEN, Tier 3 ships as the fourth shipping row on LEADERBOARD.md with per-preset footnotes covering the cost-accuracy tradeoff. If only `maximize-accuracy` passes Phase B, `minimize-cost` ships as Phase-A-only-confirmed behind a documented-experimental flag until a follow-up Phase B. `balanced` is optional and ships if Phase A is fired.

---

## 12. Implementation sequence (for the implementation plan)

Reference for the follow-up `writing-plans` session:

1. Write `src/core/policyRouter.ts` with `selectBackend` + 3 preset tables + `BackendCostPoint` data (populated from §2 per-category Phase B numbers) + pure-function unit tests (~40 tests covering edge cases, budget modes, preset behaviors, zero-accuracy guards).
2. Add RunConfig fields (`policyRouter`, `policyRouterPreset`, `policyRouterBudgetPerQuery`, `policyRouterBudgetMode`) to `IBenchmark.ts`; extend `OPTIONAL_RUN_CONFIG_KEYS` tuple; typecheck passes.
3. Add 4 CLI flags to `cli.ts` + validation (including mutual exclusion with `--om-dynamic-router`); typecheck + CLI-parse tests pass.
4. Thread `policyRouter` through `LongMemEvalS.runCase` per §3.2: before the existing `dynamicRouterOn` check, if `policyRouter === true`, call `classifyQuestion` once, then `selectBackend`, then dispatch into the appropriate branch. For Tier 2a path: pass `routerCategory: undefined` to `buildOmReaderSystemPrompt` so conditional verbatim does NOT fire. For Tier 2b path: pass the actual category. For Tier 1 path: fall through to `runFullCognitiveCase` with `useOmBranch=false`.
5. Populate `metadata.policyRouterDecision` (8 fields per §6) on every case-run.
6. Write `computePolicyRouterStats` aggregator at `src/core/metrics/computePolicyRouterStats.ts` + extend `BenchResult` shape with `policyRouterStats`; integration test over fabricated multi-case results covering: all-tier-1-routed, all-tier-2b-routed, mixed, budget-exceeded decisions.
7. Cache fingerprint `policy-router:v1:<presetHash>` added to `BenchmarkRunner.ts` `computeCaseRunKeyParts` — CONDITIONAL on `config.policyRouter === true` (§3.6 pattern).
8. `--dry-run` mode integration test to verify metadata capture + routing mix without live LLM calls.
9. Tier A N=24 live fire (~$7) with `--policy-router --policy-router-preset maximize-accuracy` + GT-category metadata spot-check.
10. If Tier A GREEN: Phase A N=102 live fire on maximize-accuracy (~$28); then minimize-cost (~$8); decide go/no-go for Phase B.
11. Phase B N=500 maximize-accuracy live fire if Phase A GREEN (~$136). Optional Phase B minimize-cost (~$40).
12. Update LEADERBOARD.md + bench blog with Tier 3 row + per-preset footnotes + updated "Tier 3 shipped" narrative section. Gated on Phase B GREEN (or Phase A GREEN for minimize-cost shipping-as-experimental).

---

## 13. Files + references

- Phase B run JSONs used for §2 cost-accuracy data:
  - Tier 1 canonical: `results/runs/2026-04-20T20-03-14-675--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - Tier 2a v10: `results/runs/2026-04-23T04-14-40-609--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
  - Tier 2b v11: `results/runs/2026-04-23T17-27-28-793--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Existing classifier: [src/observational-memory/questionRouter.ts](../../src/observational-memory/questionRouter.ts) (v10 fewshot)
- Existing router dispatch in bench: [src/benchmarks/longmemeval/LongMemEvalS.ts:289-339](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L289) (`dynamicRouterOn` + `routeQuestion` block)
- Canonical-route `runFullCognitiveCase` call: [src/benchmarks/longmemeval/LongMemEvalS.ts:635](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L635)
- `runFullCognitiveCase` definition: [src/benchmarks/longmemeval/LongMemEvalS.ts:1255](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L1255)
- Prior architecture: [ARCHITECTURE_DECISION_MATRIX_2026-04-23.md](../ARCHITECTURE_DECISION_MATRIX_2026-04-23.md)
- Prior-art routing literature (cited in bench blog §What's next):
  - [FrugalGPT (Chen et al. 2023, arXiv:2305.05176)](https://arxiv.org/abs/2305.05176)
  - [RouteLLM (LMSYS 2024)](https://lmsys.org/blog/2024-07-01-routellm/)
  - [AutoMix (Madaan et al. 2023, arXiv:2310.12963)](https://arxiv.org/abs/2310.12963)

All three prior-art systems route between MODELS at fixed pipelines. Tier 3 routes between RETRIEVAL ARCHITECTURES at a fixed reader — the genuinely under-explored axis this work exercises.

---

End of Tier 3 design spec.
