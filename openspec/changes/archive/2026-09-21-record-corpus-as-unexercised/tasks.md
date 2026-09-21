# Tasks

## A. Spec

- [x] A1 Modify the `verification` corpus requirement to oblige recording the
      unexercised status, carrying every existing scenario forward.

## B. Documentation

- [x] B1 `CONTRIBUTING.md`: the `npm run test:corpus` row currently tells
      contributors to dispatch the job after changing a prompt. State that the
      gate has never run and that no endpoint is configured.
- [x] B2 `test/corpus/README.md`: say the same at the point where the run
      instructions are given.

## C. Verification

- [x] C1 Confirm no live document still implies the corpus provides coverage.
      `openspec/project.md` and `openspec/specs/prompts/spec.md` describe the
      corpus as existing, which remains true and is not a coverage claim.
      Occurrences in `CHANGELOG.md` below the current entry are release history
      and stay as written.
- [x] C2 Confirm the claim itself is still true at the time of writing:
      `CODECROSSCHECK_BASE_URL` unset in process, User and Machine scope; no
      `CODECROSSCHECK_API_KEY` or `OPENAI_API_KEY`; nothing listening on
      localhost 11434, 1234 or 8000.
