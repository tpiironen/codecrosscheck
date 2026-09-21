# Tasks

## A. Workflow

- [x] A1 Delete the `schedule:` trigger block from `.github/workflows/ci.yml`.
- [x] A2 Change the corpus job's `if:` to test `workflow_dispatch` only, and
      update the comment above it so it no longer says "on a schedule".

## B. Documentation

- [x] B1 Update the `npm run test:corpus` row in `CONTRIBUTING.md`: it says CI
      runs the corpus nightly, which will no longer be true.

## C. Verification

- [x] C1 Confirm the pull-request gates are unchanged: `on.pull_request` still
      triggers `build-test` with lint, typecheck, test and package steps.
- [x] C2 Confirm no remaining live document claims a scheduled corpus run
      (`openspec/changes/archive/` is history and stays as written).
