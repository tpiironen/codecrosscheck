# Tasks: add-apply-review-command

## A. Schema and prompt

- [x] A1. Add `ApplyReviewSchema` to `src/schemas.ts`.
  `oldString` is allowed to be empty (create-mode); other fields are non-empty.
- [x] A2. Author `src/prompts/apply_review_worker.md` covering replace mode,
  create mode (empty `oldString`), unified-diff handling, and forbidden edits.

## B. Apply-review module

- [x] B1. Create `src/applyReview.ts` with pure functions:
  `findLatestTranscript`, `extractFixProposal`, `parseReferencedFiles`,
  `normalizeReferencedPath`, `resolveReferencedPath`, `resolveSafePath`,
  `buildFileInventory`, `composeApplyInput`, `deriveEdits`, `applyEdit`,
  `applyEdits`.
- [x] B2. Unit-test the pure functions in `test/applyReview.test.ts` with a fake fs.

## C. Slash command + handler

- [x] C1. Add `apply-review` to `package.json` chat-participant commands.
- [x] C2. Add settings `codecrosscheck.applyReview.testCommand` and
  `codecrosscheck.applyReview.dryRun`.
- [x] C3. Add `handleApplyReview(request, stream, cfg)` to `src/extension.ts`.
- [x] C4. Handler flow: locate transcript, extract proposal, parse paths,
  read files, call worker (structured output), apply edits or print
  (dry-run), run optional test command, render summary card.
- [x] C5. Path validation: reject any edit whose resolved absolute path is
  not under the workspace root.
- [x] C6. Exact-match enforcement: skip edits whose `oldString` is missing
  or appears multiple times.
- [x] C7. Test-command terminal.

## D. Documentation

- [x] D1. Update `README.md` with `/apply-review` and the workflow.
- [x] D2. Update `CHANGELOG.md` `[Unreleased]` for every feature in this
  change (initial command, settings, safety-net repairs, debug log,
  file-context injection, disagreement adjudication).
- [x] D3. Update `docs/ARCHITECTURE.md` with the apply-review section.

## E. Validation

- [x] E1. `tsc` clean.
- [x] E2. `npm test` green.
- [x] E3. `openspec validate add-apply-review-command --strict` passes.
- [ ] E4. Manual smoke test in EDH.

## F. Path normalisation and create-mode

- [x] F1. `normalizeReferencedPath` strips `(...)`, `:line`,
  `:line-line`, and surrounding backticks.
- [x] F2. `resolveReferencedPath` drops leading segments to recover
  monorepo-prefixed paths.
- [x] F3. Allow empty `oldString`; treat as create-mode in `applyEdit`
  (refuse to overwrite an existing file).
- [x] F4. Node FsLike `writeFile` does mkdir-p.

## G. oldString safety-net repairs

- [x] G1. `stripDiffMarkers(text, mode)` strips one leading marker per
  line for diff-shaped inputs.
- [x] G2. `buildOldStringCandidates(raw)` yields literal, CRLF→LF,
  LF→CRLF, and diff-stripped variants in conservative order.
- [x] G3. `repairNewStringFor(matchedOld, originalOld, originalNew)`
  pairs the `newString` with the same repair (CRLF re-emit;
  diff-stripped using `+` and context lines).
- [x] G4. `applyEdit` iterates candidates; first unique match wins. The
  skip reason still uses the original `oldString` for diagnostics.
- [x] G5. Tests cover diff-marker recovery, CRLF↔LF drift, and diff-shape
  detection edge cases.

## H. Debug log

- [x] H1. Persist `<workspace>/.codecrosscheck/runs/<iso>-apply.json` on
  every `/apply-review` run with `transcriptPath`, `iteration`,
  `referenced`, `missing`, raw `edits`, and per-edit `outcomes`.
- [x] H2. Link the debug log from chat output (including zero-edit runs).

## I. /review-branch repository file context

- [x] I1. `harvestPathsFromText(text)` pulls plausible workspace-relative
  paths and filters out URLs, absolute Windows paths, and hostnames.
- [x] I2. Before each fixer iteration, harvest paths from each reviewer
  issue's `where` and `suggestion` and from the prior fix proposal,
  read them via `buildFileInventory`, and inject as
  `# Repository file context` in the fixer input (60 000-char cap).
- [x] I3. Update `src/prompts/review_branch_fixer.md` to describe the
  section and forbid "Data I need" dodges when the source is present.
- [x] I4. Tests for `harvestPathsFromText`.

## J. Worker-disagreement adjudication

- [x] J1. `parseDisagreements(proposal)` extracts
  `**Fix:** Disagree: …` rebuttals per `### Issue N` section.
- [x] J2. `handleReviewBranch` renders rebuttals at the end of the run as
  a `🤔 N worker disagreement(s)` block, naming both the accept
  (`/apply-review`) and override (`force-fix-all`) paths.
- [x] J3. `force-fix-all` token in the user prompt (whole-word,
  case-insensitive) appends a `# User override` section to the fixer
  input. The fixer prompt forbids `**Fix:** Disagree:` in that round.
- [x] J4. Tests for `parseDisagreements`.

## K. Blocked-finding detection

- [x] K1. `parseBlockedFindings(proposal)` flags issue sections with
  dodge patterns ("Data I need", `(sketch — pending current source)`,
  "I cannot produce a patch", "pending source") that did NOT use the
  explicit `**Fix:** Disagree:` token.
- [x] K2. `handleReviewBranch` renders these as a
  `🚫 N finding(s) the worker did not produce a real patch for` block,
  diagnosing the likely cause (cited file outside workspace root) and
  pointing to the workspace-switch / `force-fix-all` remedies.
- [x] K3. Disagreement-captured issues are excluded so they are not
  reported twice.
- [x] K4. Tests for `parseBlockedFindings` (Data-I-need, sketch,
  no-double-report, fully-concrete cases).

## L. Summary copy and `/apply-review` discoverability

- [x] L1. Non-converged `/review-branch` summary clarifies that
  residual reviewer findings target the **proposal**, not the original
  branch, so the proposal itself may still contain applicable patches.
- [x] L2. Whenever a `lastFixProposal` exists (converged or not), the
  summary prints a `**Next:** run /apply-review …` line. Manual-only
  fallback only renders when no proposal exists.

## M. Reviewer exhaustiveness and complete-round rule

- [x] M1. Update `src/prompts/code_reviewer.md` with an
  `# Exhaustiveness` section requiring every finding to be listed
  (high → low → file/line order); no arbitrary cap.
- [x] M2. Update `src/prompts/review_branch_fixer.md` to require each
  round to be a complete, self-contained proposal (round-N must repeat
  any still-needed hunk from round-(N-1) verbatim, since
  `/apply-review` consumes only the final round).

## N. Per-invocation `max-iters` prompt token

- [x] N1. `/review-branch` parses `max-iters=N`, `maxiters=N`, or
  `iters=N` from the user prompt (whole-token, case-insensitive,
  range 1..20) and overrides `codecrosscheck.maxIters` for that run.
- [x] N2. Setting remains the default; prompt token wins per
  invocation.
