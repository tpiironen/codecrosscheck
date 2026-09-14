# Tasks

## A. Literal edit application
- [x] A1. Replace `original.replace(matchedOld, repairedNew)` in `applyEdit`
       with an index splice using the `indexOf` position of `matchedOld`.
- [x] A2. Add `test/applyReview.test.ts` cases asserting `$&`, `` $` ``, `$'`
       and `$$` in `newString` are written literally and reported `applied`.
- [x] A3. Add a case asserting a `$`-free replacement is byte-identical to the
       previous behaviour (regression guard).
- [x] A4. Add an `EditHost` abstraction with a `vscode.WorkspaceEdit`-backed
       implementation and an `FsLike`-backed fallback for CLI and tests.
- [x] A5. Apply the whole batch as one `applyEdit` call so it is a single undo
       step; keep path validation and occurrence counting unchanged.
- [x] A6. Tests: batch commits through the host exactly once, a later edit sees
       an earlier edit to the same file, a failed match writes nothing, and
       dry-run never commits.
- [ ] A7. **Manual, needs a running EDH:** confirm a batch is one undo step and
       that an edit to a file with unsaved changes does not raise a
       file-changed-on-disk conflict. The `EditHost` seam is unit-tested with a
       fake; the `vscode.WorkspaceEdit` implementation behind it is not, because
       it cannot be exercised outside the extension host.

## B. Honest termination reporting
- [x] B1. Change `filterRejectedIssues` to return
       `{ verdict, dropped, emptiedBySuppression }` without mutating its
       argument and without the `as { verdict: string }` assertion.
- [x] B2. Introduce a `ReviewOutcome` union (`approved` | `rebutted` |
       `exhausted`) in `handleReviewBranch` and derive it from the loop exit.
- [x] B3. Render `rebutted` with its own icon and wording; remove the
       "Reviewer is satisfied" phrasing from that path and point at the
       rebuttal list.
- [x] B4. Record the outcome in the `review-branch-done` transcript event so
       `/apply-review` and future tooling can read it.
- [x] B5. Add unit tests for `filterRejectedIssues` covering the emptied-by-
       suppression flag and argument immutability.

## C. Docs
- [x] C1. CHANGELOG `Fixed` entries for both defects.
- [x] C2. docs/ARCHITECTURE.md: document the three review outcomes.
