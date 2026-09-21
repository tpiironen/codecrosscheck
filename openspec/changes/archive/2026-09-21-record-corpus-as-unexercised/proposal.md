# Record the corpus gate as unexercised

## Why

The planted-flaw corpus is the project's only automated evidence that the
reviewer prompts behave as intended. It has never run. Task E2 of
`replace-context-harvest-with-tools` was archived unticked, and the 0.5.0 notes
carry it as a "Known gap".

It is now clear this is permanent, not pending. The harness talks to an
OpenAI-compatible HTTP endpoint through `OpenAiCompatibleClient`; the project
has no such endpoint and no model token, and there is no keyless route to one
— the VS Code Language Model API exists only inside the extension host, where
the test runner cannot reach it. Checked 2026-09-21: `CODECROSSCHECK_BASE_URL`
is unset in every environment scope, no API key is present, and no local server
is listening.

Carrying E2 as an open task implies it is waiting on scheduling. It is not.
Meanwhile `CONTRIBUTING.md` tells contributors to dispatch the corpus job after
changing a prompt — an instruction nobody in this project can follow.

The existing requirement already says a permanently inert gate must not
masquerade as a passing one. That principle was applied to test *output*; it
was never applied to the documentation, which still reads as though the gate
is live.

## What Changes

- The `verification` requirement gains the obligation to record the gate's
  unexercised status wherever a reader would look for evidence of prompt
  coverage, and to state the missing prerequisite alongside any instruction to
  run it.
- `CONTRIBUTING.md` and `test/corpus/README.md` say plainly that the corpus has
  never been executed and what it would take to change that.

Out of scope: deleting the corpus fixtures, and re-pointing the harness at the
VS Code Language Model API. Both were considered. The fixtures cost nothing to
keep and are the starting point for anyone who does configure an endpoint; the
re-pointing is a design change that needs its own proposal.

## Impact

- **Affected specs**: `verification` (1 MODIFIED).
- **Affected code**: `CONTRIBUTING.md`, `test/corpus/README.md`. No runtime
  code changes — `test/corpus.test.ts` already reports its skip reason.
- **Risk surface**: none to runtime. The honest risk is stated rather than
  created: reviewer prompt behaviour is unverified, and a regression in
  `src/prompts/` would reach users uncaught.
