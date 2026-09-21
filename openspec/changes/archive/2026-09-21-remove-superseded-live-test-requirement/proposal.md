# Change: remove-superseded-live-test-requirement

## Why

`openspec/specs/verification/spec.md` still carries "Gated live integration
test", which requires:

> a live integration test that exercises the GitHub Models endpoint with the
> default model pair. The test SHALL be skipped unless `RUN_LIVE_TESTS=1` AND
> `GITHUB_TOKEN` are both present in the environment.

Every clause of it is now false, and one of them contradicts another
requirement in the same file:

- **The endpoint is gone.** GitHub Models was retired 2026-07-30.
  `replace-github-models-with-openai-compatible` removed the client; there is
  no default provider, and `OpenAiCompatibleClient` requires
  `CODECROSSCHECK_BASE_URL`.
- **`GITHUB_TOKEN` gates nothing.** It appears in no test. The only live gate
  in the suite is `test/corpus.test.ts`, which reads `RUN_LIVE_TESTS` and
  `CODECROSSCHECK_BASE_URL`.
- **There is no separate live integration test.** `RUN_LIVE_TESTS` is read in
  exactly one test file, the corpus harness.
- **Its success scenario contradicts the corpus requirement.** This requirement
  asserts "the live test passes AND at least one structured verdict is parsed
  from a real API response". "The planted-flaw corpus SHALL be runnable and its
  skipping visible" states the opposite: the corpus "has never been executed",
  and the project SHALL NOT describe reviewer prompt behaviour as verified.

A spec that asserts a verdict has been parsed from a real API response is
exactly the claim the corpus requirement was written to prevent. Leaving both
in place means the file argues with itself, and a reader can cite whichever
suits them.

## What Changes

- The "Gated live integration test" requirement is **removed**. It is
  superseded in full by "The planted-flaw corpus SHALL be runnable and its
  skipping visible", which already covers manual-dispatch invocation, skipping
  with a stated reason, and the obligation not to imply coverage the gate never
  gave.
- The obligation that ungated tests pass without `RUN_LIVE_TESTS` is unaffected
  — it lives in "Deterministic unit tests" and is not touched.
- No behaviour changes. No test is added, removed or re-gated.

## Impact

- Affected specs: `verification` (one removed requirement).
- Affected code: none.
- Risk: none. Removing a requirement that no test satisfies cannot regress a
  gate. The alternative — rewriting it around `CODECROSSCHECK_BASE_URL` — would
  recreate the contradiction with the corpus requirement in new wording.
