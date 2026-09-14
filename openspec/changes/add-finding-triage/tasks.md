# Tasks: add-finding-triage

- [x] 1.1 Add `TriageSchema` to `src/schemas.ts`: an array of entries with
      `id`, `status` (`confirmed` | `rejected` | `uncertain`) and `evidence`.
- [x] 1.2 Add `src/prompts/finding_triage.md`. Rejection must be presented as
      an equally valid answer, evidence must be required in both directions,
      and the prompt must forbid deciding on plausibility alone.
- [x] 1.3 Add `buildTriager()` to `src/agents.ts`, using `sendStructured` so
      the result is schema-validated rather than parsed from prose.
- [x] 1.4 Run triage in `handleReviewBranch` between the reviewer verdict and
      the fixer call, with the cited-file inventory as evidence context.
- [x] 1.5 Pass only `confirmed` findings to the fixer. Report `rejected` and
      `uncertain` findings in chat with their evidence.
      — `selectConfirmedFindings` in `src/triage.ts`, rendered by `renderTriage`.
- [x] 1.6 Bypass triage entirely when `force-fix-all` is given.
- [x] 1.7 Record triage in a `review-branch-triage` transcript event.
- [x] 1.8 Report the all-rejected case as the code being defended, not as an
      approval of a fix proposal. — new `defended` outcome, documented in
      `docs/ARCHITECTURE.md`.
- [x] 1.9 Tests: schema accepts valid triage and rejects a missing status;
      confirmed-only findings reach the fixer; `force-fix-all` bypasses triage;
      an all-rejected verdict short-circuits without a fixer call.
      — 10 tests in `test/triage.test.ts`.
- [x] 1.10 Red-proof at least one test. — defaulting an unjudged finding to
      `confirmed` instead of `uncertain` fails the unjudged-finding test.
- [x] 1.11 Run lint, typecheck, the full suite, and
      `npx openspec validate add-finding-triage --strict`.
      — all green, 174 passed / 8 skipped.
