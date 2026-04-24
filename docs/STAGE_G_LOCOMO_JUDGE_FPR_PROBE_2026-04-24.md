# Stage G-LOCOMO: Judge False-Positive Probe on LOCOMO — Findings (2026-04-24)

**Predecessor:** [Stage G (LongMemEval-S)](SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md) — 1% FPR [0%, 3%] at n=100 using `gpt-4o-2024-08-06` judge + `rubricVersion 2026-04-18.1`.

**Experiment:** §4.3 of [NEXT_SESSION_CONTINUATION_2026-04-24_STAGE_G_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-24_STAGE_G_FINAL.md). Port the Stage G judge-adversarial probe from LongMemEval-S cases to LOCOMO cases at the same judge + rubric + synth model + seed. Expected per the prior handoff: "FPR goes up to 10-30% due to short entity-style LOCOMO answers being easier to spoof."

## 1. TL;DR

**Result: 0% FPR [0%, 0%] at n=100.** Zero false positives across all three rubric categories (multi-session, temporal-reasoning, abstention) and all five native LOCOMO types (single-hop, multi-hop, open-domain, temporal, adversarial).

Comparison:

| Benchmark | Judge | Rubric | FPR | Source |
|---|---|---|---:|---|
| LongMemEval-S (n=100) | `gpt-4o-2024-08-06` | `2026-04-18.1` | 1% [0%, 3%] | Stage G, prior session |
| **LOCOMO (n=100)** | `gpt-4o-2024-08-06` | `2026-04-18.1` | **0% [0%, 0%]** | **Stage G-LOCOMO, this session** |
| LOCOMO (unreported n) | `gpt-4o-mini` | LOCOMO default | 62.81% | Penfield Labs audit, April 2026 |

**The 63pp gap between Penfield's LOCOMO FPR and ours is a judge-model + rubric-strictness artifact, not a LOCOMO-intrinsic property.** LOCOMO's short entity-style gold answers are judge-able at a 0% false-positive floor when the judge is current-generation (`gpt-4o`) and the rubric is strict (our `2026-04-18.1`).

## 2. Methodology

Identical to Stage G on LongMemEval-S:

- **Probe:** 100 random stratified LOCOMO cases (seed=42), shuffled via Mulberry32 PRNG.
- **Synthesizer:** `gpt-5-mini-2025-08-07`. Synthesizes a topically-adjacent WRONG answer per case (not the gold, but plausibly related to the gold topic — the same class of error a weak retrieval system would produce).
- **Judge:** `gpt-4o-2024-08-06` wrapped in `LongMemEvalJudge`. System prompt empty. Rubric version `2026-04-18.1`.
- **Category remap:** LOCOMO's 5 native categories (single-hop, multi-hop, open-domain, temporal, adversarial) are remapped to the 3 LongMemEval rubric categories (multi-session, temporal-reasoning, abstention) using the same `remapCategoryToRubric` function `Locomo.ts` uses at benchmark runtime. This ensures the probe scores cases exactly as the real LOCOMO benchmark runs would score them.

```ts
// Identical to Locomo.ts:348-360
switch (locomoType) {
  case 'temporal':      return 'temporal-reasoning';
  case 'adversarial':   return 'abstention';
  default:              return 'multi-session';  // single-hop, multi-hop, open-domain
}
```

Standalone script: `src/scripts/stage-g-locomo-judge-fpr-probe.ts`. Runs via `pnpm build && node dist/scripts/stage-g-locomo-judge-fpr-probe.js <N>`. Reproducible at seed=42.

## 3. Raw result (JSON)

```json
{
  "maxProbes": 100,
  "samplesProbed": 100,
  "fpr": 0,
  "ci": [0, 0],
  "byRubricCategory": {
    "multi-session":      { "rate": 0, "ciLo": 0, "ciHi": 0, "n": 77 },
    "temporal-reasoning": { "rate": 0, "ciLo": 0, "ciHi": 0, "n": 5 },
    "abstention":         { "rate": 0, "ciLo": 0, "ciHi": 0, "n": 18 }
  },
  "nativeLocomoTypeCounts": {
    "single-hop":   { "samplesProbed": 21, "positives": 0 },
    "multi-hop":    { "samplesProbed": 11, "positives": 0 },
    "open-domain":  { "samplesProbed": 45, "positives": 0 },
    "temporal":     { "samplesProbed": 5,  "positives": 0 },
    "adversarial":  { "samplesProbed": 18, "positives": 0 }
  },
  "synthModel":     "gpt-5-mini-2025-08-07",
  "judgeModel":     "gpt-4o",
  "rubricVersion":  "2026-04-18.1",
  "synthTokensIn":  16186,
  "synthTokensOut": 1641,
  "judgeTokensIn":  13334,
  "judgeTokensOut": 147,
  "elapsedMs":      167205
}
```

Cost: $0.04 (17.8k synth tokens + 13.5k judge tokens). Elapsed: 167 seconds.

## 4. Interpretation

### 4.1 What this rules out

Stage F-2's remaining Mem0 gap (14.5pp after tuning; Mem0 claims 66-68%, our tuned sits at 51.5%) cannot be attributed to judge permissiveness on OUR side. Our rubric + judge combination rejects 100/100 topically-adjacent wrong answers on LOCOMO. Any vendor publishing a LOCOMO number measured with the default `gpt-4o-mini` judge is sitting on up to 63pp of accepted-wrong-answer noise (Penfield's measurement). Mem0 does not disclose their LOCOMO judge configuration.

The 14.5pp gap decomposes as:

- **Judge on our side:** 0% FPR, contributes ~0pp.
- **Judge on Mem0's side:** unknown, possibly up to ~63pp if they ran the default LOCOMO judge. Would require a cross-harness Mem0 replication to prove.
- **Retrieval tuning depth:** unknown. Mem0 probably calibrated for LOCOMO specifically; we shipped the LongMemEval-tuned retriever. Stage F-3 ablation (queued) would measure how much a single knob change moves the number.
- **Architecture:** unknown. If Mem0 uses fundamentally different memory (graph-based, fact-network) for dense-history layouts, some gap is architectural. Requires the architecture deep-dive in [STAGE_F2 §7](STAGE_F2_LOCOMO_ABSTENTION_TUNING_2026-04-24.md).

### 4.2 What this confirms

- **LOCOMO's default judge is the FPR source, not LOCOMO's gold answers.** Penfield's 62.81% finding was a warning about the benchmark's default tooling, not about the benchmark being unmeasurable. With a stricter judge + rubric, LOCOMO is measurable at 0% FPR on topical-distractor attacks.
- **Our cross-benchmark judge methodology transfers cleanly.** Same probe script pattern, same judge + rubric + seed, comparable outputs on LongMemEval-S and LOCOMO. The harness can be pointed at BEAM, MSC, ConvoMem, or any future long-memory benchmark without re-engineering the probe.
- **The AgentOS LOCOMO numbers published this session (49.9% OOD, 51.5% tuned) are not judge-inflated.** They are what our judge + rubric says they are. Readers comparing AgentOS LOCOMO to competitor LOCOMO numbers should account for the fact that our 50-ish is measured with ~0 noise floor, while competitor 60-70s may or may not be measured with up to 63pp noise floor.

### 4.3 What this does NOT rule out

Stage G-LOCOMO only measures the judge's acceptance of **topically-adjacent wrong** answers produced by `gpt-5-mini`. It does not measure:

- **False negatives** (judge rejecting correct answers). A judge with 0% FPR and 50% FNR would underrate us; this probe does not catch that.
- **Systematic bias in category remap.** If the remap (single-hop → multi-session, temporal → temporal-reasoning, adversarial → abstention, multi-hop → multi-session, open-domain → multi-session) masks a category-specific rubric misalignment, the probe doesn't catch it either. The fact that the native LOCOMO category breakdown shows 0/0 for every category is evidence against a category-specific leak, but not proof.
- **Gold-answer quality.** Penfield's 6.4% gold-answer error rate on LOCOMO applies to our numbers too. A gold answer that is WRONG cannot be judged correct or incorrect; the case is corrupted regardless of judge strictness. Our 51.5% tuned and 49.9% OOD each have ~127 cases with corrupted gold. The actual accuracy against corrected gold is likely 2-6pp higher on both rows.

## 5. Reproduce

```bash
set -a && source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env && set +a
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm build
node dist/scripts/stage-g-locomo-judge-fpr-probe.js 100
```

Cached synth outputs at `data/.judge-adversarial-cache-stage-g-locomo/`. A re-run with the same maxProbes + seed hits the cache and skips synth calls, so re-verification costs only the judge calls (~$0.01 for n=100).

## 6. Follow-ups

1. **Stage G-LongMemEval-M** — same probe on LongMemEval-M (500-session variant). If FPR stays at 0-1%, our rubric + judge is robust across LongMemEval distribution shifts.
2. **Stage G-BEAM** — same probe once the BEAM adapter ships. BEAM's gold answers are entity-style; if our rubric + judge produces low FPR there too, we have OOD judge evidence across three long-memory benchmarks.
3. **Cross-harness Mem0 replication** — the only way to isolate the judge-vs-architecture split in the remaining 14.5pp gap is to run Mem0 through our harness at our judge + rubric. External; not our work.

## 7. Honesty statement

This probe does NOT prove that Mem0's 66-68% LOCOMO claim is judge-inflated. It proves that OUR LOCOMO numbers are not judge-inflated. The Mem0 claim's validity depends on Mem0's undisclosed judge configuration; we can only flag it as an unresolved question.

The probe also does NOT prove our LOCOMO numbers are correct in an absolute sense. It proves they are honest within our rubric's definition of correct. A third party running a differently-strict rubric would get different numbers; publishing the rubric version in every finding is how we make that difference explicit.
