# AgentOS Memory Rollout — Next Session Handoff

**Status:** superseded by
[COMPREHENSIVE_HANDOFF_2026-04-21.md](./COMPREHENSIVE_HANDOFF_2026-04-21.md)
as of 2026-04-21. The comprehensive handoff is the single source of
truth for continuing this rollout.

## What this file used to be

Prior sessions maintained a narrow "next-session" pointer here, but it
fell behind the real state as Steps 9 (fact-graph), 11 (tuned reflector
prompt), and 12 (BM25 parity for ADDITIVE mode) landed in quick
succession. Keeping two handoffs in sync doubles the update burden and
risks drift. We now use one canonical doc.

## Where to go

1. Start with [COMPREHENSIVE_HANDOFF_2026-04-21.md](./COMPREHENSIVE_HANDOFF_2026-04-21.md).
2. Its §1 has the continuation prompt to paste into a fresh session.
3. §2 has the session timeline including Step 12 verdict.
4. §4 has the updated pattern table.
5. §7 lists next-step candidates with priority ordering.

## Related material

- Umbrella findings: [RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md](./RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md)
- Blog post: [blog/2026-04-20-agentos-memory-longmemeval-rollout.md](./blog/2026-04-20-agentos-memory-longmemeval-rollout.md)
- Per-step findings: `STEP_N_*_FINDINGS_2026-04-YY.md`
- Specs + plans: `specs/` and `plans/` (bench-level, not gitignored)

End of redirect.
