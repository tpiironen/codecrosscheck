# verification delta: remove-superseded-live-test-requirement

## REMOVED Requirements

### Requirement: Gated live integration test

**Reason**: Every clause is false and one contradicts a sibling requirement.
The GitHub Models endpoint it names was retired 2026-07-30 and its client was
deleted by `replace-github-models-with-openai-compatible`. `GITHUB_TOKEN` gates
no test in the suite. `RUN_LIVE_TESTS` is read in exactly one file,
`test/corpus.test.ts`, which gates on `CODECROSSCHECK_BASE_URL` instead. Its
success scenario asserts that a structured verdict has been parsed from a real
API response, which directly contradicts "The planted-flaw corpus SHALL be
runnable and its skipping visible" — that requirement records that the corpus
has never been executed and forbids describing reviewer prompt behaviour as
verified.

**Migration**: None required. No test satisfies this requirement today, so
nothing is re-gated by its removal. Manual-dispatch invocation, skipping with a
stated reason, and the prohibition on implying uncovered behaviour are all
already required by "The planted-flaw corpus SHALL be runnable and its skipping
visible". The obligation that the ungated suite passes without `RUN_LIVE_TESTS`
remains in "Deterministic unit tests".
