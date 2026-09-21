# Tasks: remove-superseded-live-test-requirement

- [ ] 1.1 Confirm the removed header matches the live spec heading exactly. A
      `## REMOVED` header absent from the live spec passes `validate` but
      aborts `archive`.
- [ ] 1.2 Confirm no test satisfies the requirement: `RUN_LIVE_TESTS` appears
      in `test/corpus.test.ts` only, and `GITHUB_TOKEN` in no test.
- [ ] 1.3 Confirm "Deterministic unit tests" still carries the obligation that
      tests not gated by `RUN_LIVE_TESTS` pass, so removing this requirement
      leaves no gap.
- [ ] 1.4 Run `npx openspec validate remove-superseded-live-test-requirement --strict`.
- [ ] 1.5 Run lint, both typechecks and the full suite.
- [ ] 1.6 On archive, confirm the live `verification` spec has 11 requirements
      and that "The planted-flaw corpus SHALL be runnable and its skipping
      visible" retained all 5 of its scenarios.
