# Remove the nightly corpus schedule

## Why

The `corpus` CI job sends planted-flaw fixtures to a live model, so every run
spends tokens. It is currently wired to a nightly `schedule:` trigger, which
bills for a run nobody asked for and which nobody reads on a green day.

It is also failing: the job reads `vars.CCC_BASE_URL` and `secrets.CCC_API_KEY`,
and neither is configured on the repository, so all six model-backed cases throw
`CODECROSSCHECK_BASE_URL required for non-validator corpus cases` every night.
The recurring red is noise on a gate that is not actually armed.

Manual dispatch keeps the gate available for the moment it matters — before a
prompt change lands — without a standing charge.

## What Changes

- Remove the `schedule:` trigger from the CI workflow, so the corpus job runs
  only on `workflow_dispatch`.
- Narrow the corpus job's `if:` condition to `workflow_dispatch` alone.
- Update `CONTRIBUTING.md`, which currently tells contributors CI runs the
  corpus nightly.

Out of scope: configuring `CCC_BASE_URL`/`CCC_API_KEY`, and any change to the
corpus harness itself. The pull-request gates (lint, typecheck, test, package)
are untouched.

## Impact

- **Affected specs**: `verification` — one MODIFIED requirement.
- **Affected code**: `.github/workflows/ci.yml`, `CONTRIBUTING.md`.
- **Risk surface**: reviewer-prompt regressions are no longer caught by an
  unattended run. Accepted deliberately: the unattended run was not catching
  them either, because it had no endpoint. Whoever edits `src/prompts/` is
  responsible for dispatching the job.
