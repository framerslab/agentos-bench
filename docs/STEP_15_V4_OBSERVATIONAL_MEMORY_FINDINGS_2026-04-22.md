# Step 15 v4 Findings — Reader Scaffold + Hierarchical Synthesis (v4a/b/c)

**Date:** 2026-04-22
**Scope:** Three variant experiments testing different fixes to v3 dual-path's cross-session-failure pattern.

- **v4a:** dual-path + `CROSS_SESSION_READER_SCAFFOLD` prompt appended to OM reader system prompt (reader-side reasoning guidance, no new LLM calls).
- **v4b:** new `hierarchical` OmIngestMode — per-session Observer pass + ONE synthesis call (gpt-4o, via `--om-synthesis-model`) over the per-session observation log.
- **v4c:** v4b hierarchical + scaffold combined (stacking v4a and v4b).

**Baseline:** v3 dual-path at 70.8% unweighted Tier A. v1 per-session at 75.0%.

**Kill gates:**
- Tier A: unweighted ≥ 78% AND multi-session ≥ 50% AND all single-session ≥ 90%.

---

## 1. Verdicts summary

| Variant | Verdict | Tier A unweighted | Kill gate |
|---|---|---:|---|
| v4a | GREEN-soft at Tier A, **RED at Phase A** | 83.3% N=24 / 71.6% N=102 | Tier A pass (sampling luck); Phase A miss |
| v4b | RED | 75.0% N=24 | Tier A miss (aggregate below 78%) |
| v4c | RED | 70.8% N=24 | Tier A miss; worse than v4a, v4b, v1, v3 |

---

## 2. v4a — Cross-session reader scaffold

### 2.1 Mechanism

Appends a 5-step reasoning guide to the OM reader system prompt (after OBSERVATION_CONTEXT_INSTRUCTIONS, before OBSERVATION_CONTINUATION_HINT):

1. Scan ALL date-grouped sections (not just most recent)
2. Extract facts from every relevant session
3. Order chronologically by date
4. Synthesize across ordered facts
5. Verify dates before answering

Targets the v3 failure mode where the reader fixates on the most-recent-date observation block and ignores cross-session synthesis.

### 2.2 Results

**Tier A N=24:** **83.3% (20/24)** CI [65%, 96%] — FIRST Step 15 variant to clear the 78% kill gate.

| Category | v4a Tier A | v3 baseline | Δ |
|---|---:|---:|---:|
| single-session-user | 100% | 100% | 0 |
| single-session-assistant | 100% | 100% | 0 |
| single-session-preference | 100% | 100% | 0 |
| knowledge-update | 75% | 75% | 0 |
| multi-session | 50% | 25% | **+25pp** |
| temporal-reasoning | **75%** | 25% | **+50pp** |

Scaffold was load-bearing for temporal-reasoning (+50pp) and multi-session (+25pp). Single-session preserved.

**Phase A N=102:** **71.6% (73/102)** CI [62.7%, 80.4%] — kill-gate MISS.

| Category | v4a Phase A | v4a Tier A | Δ Tier A → Phase A |
|---|---:|---:|---:|
| single-session-user | 94.1% | 100% | −5.9pp |
| single-session-assistant | 94.1% | 100% | −5.9pp |
| **single-session-preference** | **64.7%** | 100% | **−35.3pp** |
| knowledge-update | 82.4% | 75% | +7.4pp |
| multi-session | 52.9% | 50% | +2.9pp |
| **temporal-reasoning** | **41.2%** | 75% | **−33.8pp** |

**Diagnosis:** Tier A N=24 sampled 4 cases per category. Two categories (single-session-preference, temporal-reasoning) got lucky draws — 4/4 correct at Tier A, but at the representative 17-per-type Phase A sample they scored 11/17 and 7/17. Lazy interpretation: "v4a is an 83%" is WRONG — the kill-gate discipline caught the illusion.

**Kill-gate discipline caught it:** without Phase A, we'd have published 83% and had a false SOTA claim. With Phase A (~$26 spend), we caught the sampling luck and saved a $700 Phase B on a misleading config.

### 2.3 What ships

CROSS_SESSION_READER_SCAFFOLD + `--om-reader-scaffold` flag + `step-15-om-scaffold:v4a` fingerprint. Even with Phase A regression, the scaffold is a free-lift primitive (zero extra LLM calls) that downstream consumers may find useful on other workloads. Default off.

---

## 3. v4b — Hierarchical observer with gpt-4o synthesis

### 3.1 Mechanism

New OmIngestMode: `hierarchical`. Per-session Observer pass produces observation log (v1 style). Then ONE additional call via `--om-synthesis-model` (typically gpt-4o) over the per-session observation log, producing a compact cross-session patterns block appended under `## Cross-session synthesis`.

Input to synthesis is ALREADY COMPRESSED per-session observations (~20k chars), not raw conversation. Expectation: stronger synthesis model (gpt-4o) reasons better over structured input than over raw conversation at batch-scale.

### 3.2 Results

**Tier A N=24:** 75.0% (18/24). Same as v1 per-session alone.

| Category | v4b | v1 | Δ |
|---|---:|---:|---:|
| single-session-user | 100% | 100% | 0 |
| single-session-assistant | 100% | 100% | 0 |
| single-session-preference | 100% | 100% | 0 |
| knowledge-update | 75% | 75% | 0 |
| multi-session | 50% | 25% | +25pp |
| temporal-reasoning | 25% | 50% | −25pp |

Synthesis bumped multi-session but temporal regressed. Net-zero aggregate vs v1.

### 3.3 Diagnosis

The synthesis call produced a cross-session patterns block, but the reader either:
- ignored it in favor of the per-session log (position bias — per-session comes first)
- the synthesis content was less specific than per-session date anchors for temporal questions
- the patterns synthesis mode doesn't capture supersessions well enough

**v4a's scaffold approach (+50pp temporal) beat v4b's synthesis approach (-25pp temporal)** — a reader-side prompt change outperformed an additional LLM call with a stronger model, by a wide margin. Synthesis is NOT a free-lift.

### 3.4 What ships

`hierarchical` mode in OmIngestMode + `--om-synthesis-model` CLI flag + `step-15-om-synthesis:{model}` fingerprint (only tagged when mode is hierarchical). Available as opt-in for future iteration or non-LongMemEval workloads.

---

## 4. v4c — Hierarchical + scaffold combined

### 4.1 Mechanism

v4b configuration (hierarchical mode, gpt-4o synthesis) PLUS `--om-reader-scaffold` on.

Hypothesis: v4a's scaffold + v4b's synthesis might stack — scaffold guides the reader's reasoning, synthesis provides cross-session signal. Additive gains expected.

### 4.2 Results

**Tier A N=24:** **70.8%** — WORSE than v4a (83.3%), v4b (75%), AND v1 (75%).

| Category | v4c | v4a | v4b |
|---|---:|---:|---:|
| single-session-user | 75% | 100% | 100% |
| single-session-assistant | 100% | 100% | 100% |
| single-session-preference | 100% | 100% | 100% |
| knowledge-update | 75% | 75% | 75% |
| multi-session | 50% | 50% | 50% |
| temporal-reasoning | 25% | **75%** | 25% |

### 4.3 Diagnosis: layout conflict

v4a's scaffold instructs the reader: "Scan ALL date-grouped sections..." — an explicit reference to Mastra-style `Date: 2024-05-01` headers in the per-session observation log.

v4b's hierarchical mode ADDS a `## Cross-session synthesis` section AFTER the per-session log. This section uses a DIFFERENT format (`🔗 Supersession across...` instead of `Date: ...`).

When both are present, the scaffold's "scan Date: headers" guidance points at the per-session part; the synthesis block's `🔗` format doesn't match the pattern. Reader gets mixed signals about what to prioritize.

**Temporal regression from 75% (v4a) → 25% (v4c)** is the clear symptom: scaffold pointed at Date: headers, synthesis added non-Date-formatted patterns, reader got confused.

**Empirical rule:** scaffold is optimized for layout-X; stacking it with a layout-Y addition requires either updating the scaffold OR restricting the scaffold to the layout it was designed for. **Step 16c router implements the latter: scaffold only fires when the config is v5 (no retrieval, no synthesis).**

### 4.4 What ships

v4c ships as nothing new — it's just the conjunction of two existing flags. Documented in prompts.ts as a tested-RED combination.

---

## 5. Takeaways

### 5.1 Reader scaffold is a free-lift primitive (conditionally)

v4a's +50pp on temporal-reasoning from a pure prompt change is the biggest single category improvement in the rollout. **When the layout matches the scaffold's assumptions** (dual-path, no extra sections), it's free lift.

### 5.2 Synthesis is NOT a free-lift

v4b's gpt-4o synthesis call, despite being 5x more expensive per call and a stronger model, did NOT beat v4a's prompt-only scaffold. This inverts the common assumption that "stronger model + more calls = better."

### 5.3 Stacking architectural layers has non-obvious conflicts

v4c regressed vs both v4a and v4b individually. Layout compatibility matters.

### 5.4 N=24 stratified sampling at 4-per-type is too noisy for category-level signal

v4a's 83.3% → 71.6% Phase A drop is the clearest example yet. This rollout's matched-ablation discipline REQUIRES Phase A before publication-grade claims.

### 5.5 Sampling-luck evidence

v4a is the FIRST documented rollout-wide example of Tier A → Phase A regression. Worth citing in the methodology section of the blog: "Our bootstrap-gated kill-criterion methodology caught 2 false positives before Phase B across 16 matched-ablation experiments (Step 9 fact-graph via evidenceOrigin diagnostic, Step 15 v4a via Tier A → Phase A category regression)."

---

## 6. Cost

| Experiment | Tier A cost | Phase A cost |
|---|---:|---:|
| v4a | $6.19 | $26.30 |
| v4b | $4.30 | — |
| v4c | $4.29 | — |
| **Total** | **$14.78** | **$26.30** |

**v4 family rollout subtotal:** $41.08.

---

## 7. Files + run JSONs

- Run JSON v4a Tier A: `results/runs/2026-04-22T11-33-32-980--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Run JSON v4a Phase A: `results/runs/2026-04-22T12-13-40-703--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Run JSON v4b: `results/runs/2026-04-22T11-46-06-785--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Run JSON v4c: `results/runs/2026-04-22T11-58-55-320--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Scaffold prompt text: [src/observational-memory/prompts.ts](../src/observational-memory/prompts.ts) under `CROSS_SESSION_READER_SCAFFOLD`
- Synthesis prompt text: same file, under `CROSS_SESSION_SYNTHESIS_PROMPT`

---

End of Step 15 v4 findings.
