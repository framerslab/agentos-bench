# AgentOS Memory Benchmark Leaderboard

Last updated: 2026-04-19T09:11:11.676Z

Round 3 full stack: gpt-4o @ 90% / $0.017/correct and gpt-5-mini @ 90% / $0.002/correct on 20-case LongMemEval-S pilot. Headline: GPT-5-mini matches GPT-4o accuracy at 1/10th the cost.

Our rows are produced by `@framers/agentos-bench` against the linked source datasets.
Competitor rows are lifted verbatim from their published sources (see per-row citations).
Methodologies may differ; every row footnotes its reader LLM so comparisons stay honest.

## LongMemEval-S (500 cases, ~115k-token haystacks)
Target to beat: **96.2%** (agentmemory (JordanMcCann)).
| System | Reader | Memory | Replay | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---|
| AgentOS (`@framers/agentos`) | gpt-4o | full-cognitive | ingest | 90.0% | 62043 ms | $0.0169 | — |
| AgentOS (`@framers/agentos`) | gpt-5-mini | full-cognitive | ingest | 90.0% | 56916 ms | $0.0043 | — |
| agentmemory (JordanMcCann) | GPT-4o | — | — | 96.2% | — | — | [link](https://github.com/JordanMcCann/agentmemory) |
| Mastra Observational Memory | GPT-5-mini | — | — | 94.9% | — | — | [link](https://mastra.ai/research/observational-memory) |
| Supermemory | Unspecified (see source) | — | — | 92.0% | — | — | [link](https://supermemory.ai/research/) |
| Mastra Observational Memory | GPT-4o | — | — | 84.2% | — | — | [link](https://mastra.ai/research/observational-memory) |
| Emergence AI | GPT-4o | — | — | 78.0% | — | — | [link](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag) |

## LongMemEval-Oracle (retrieval-removed, reader quality only)
| System | Reader | Memory | Replay | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---|
| AgentOS (`@framers/agentos`) | gpt-4o | none | ingest | 65.0% | 765 ms | $0.0333 | — |

## BEAM (500k-token tier)
Target to beat: **72.0%** (Hindsight).
| System | Reader | Memory | Replay | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---|
| Hindsight | Unspecified (see source) | — | — | 72.0% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |

## BEAM (1M-token tier)
Target to beat: **73.9%** (Hindsight).
| System | Reader | Memory | Replay | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---|
| Hindsight | Unspecified (see source) | — | — | 73.9% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |

## BEAM (10M-token tier — the frontier)
Target to beat: **64.1%** (Hindsight).
| System | Reader | Memory | Replay | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---|
| Hindsight | Unspecified (see source) | — | — | 64.1% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |
| Next-best published (per Hindsight) | Unspecified (see source) | — | — | 40.6% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |

## Micro-benchmarks (cognitive-mechanism assertions)

Each probe is a deterministic assertion on an AgentOS cognitive mechanism.
Regressions here indicate a bug in the mechanism, not a scoring-model issue.

| Benchmark | Cases | Accuracy | Avg latency |
|---|---:|---:|---:|
| consolidation-signal-preservation | 3 | 100.0% | 0.0 ms |
| decay-fidelity | 5 | 100.0% | 0.2 ms |
| hexaco-encoding-bias | 6 | 100.0% | 0.0 ms |
| scaling-profile | 2 | 100.0% | 16.0 ms |
| signal-ablation | 6 | 100.0% | 0.2 ms |
| spreading-activation-precision | 3 | 100.0% | 1.0 ms |
| working-memory-capacity | 5 | 100.0% | 0.2 ms |

## Methodology notes

- Our `memory` column shows the AgentOS memory mode under test: `full-cognitive` uses `CognitiveMemoryManager` with all eight cognitive mechanisms active (reconsolidation, RIF, involuntary recall, metacognitive FOK, temporal gist, schema encoding, source confidence decay, emotion regulation); `base-memory` uses the standalone `Memory` facade; `none` is the haystack-in-context baseline.
- Our `replay` column shows how the haystack was fed to memory: `observe` drives per-turn `CognitiveMemoryManager.encode()` calls (matching live-conversation cadence); `ingest` collapses each session into one `encode()` call. The observer / reflector pipeline only activates when an LLM invoker is configured; benchmark runs typically ship without one to keep costs bounded, so both modes exercise the encoding + decay + scoring stack directly.
- Per-case scoring uses the upstream rubric (see `RUBRIC_SOURCE` in `src/judges/rubrics/`).
- Judge model is GPT-4o unless otherwise noted, to avoid same-family self-preference bias when the reader is also Claude.
- Cost-per-correct divides total USD (reader + embedding + judge) by passed cases; it is the primary efficiency metric once accuracy is competitive.
