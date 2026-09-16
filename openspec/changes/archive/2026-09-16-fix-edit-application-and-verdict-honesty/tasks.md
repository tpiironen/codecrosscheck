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
- [x] A7. **Manual, needs a running EDH:** confirm a batch is one undo step and
       that an edit to a file with unsaved changes does not raise a
       file-changed-on-disk conflict. The `EditHost` seam is unit-tested with a
       fake; the `vscode.WorkspaceEdit` implementation behind it is not, because
       it cannot be exercised outside the extension host.
       — **Verified 2026-09-14** in an Extension Development Host against the
       worktree at `C:\src\AI-review`, in two passes.
       *Dirty buffer:* `/apply-review` derived and applied 6 edits to
       `src/extension.ts` while that file had unsaved changes. The edits merged
       into the dirty buffer and no file-changed-on-disk conflict appeared.
       *One undo step:* from a clean worktree, `/apply-review` applied 6 edits,
       one Ctrl+Z was pressed, and the file was then **saved**. `git status`
       reported the worktree clean, so every edit had reverted. The save is what
       makes this decisive: a partial undo would have left a modified file.
       A first attempt was discarded as inconclusive — the tester closed the
       file without saving, which discards the buffer and produces the same disk
       state whether the undo reverted everything, something or nothing.
       Note: this could not be run at all until
       `fix-referenced-path-normalisation` landed — before that,
       `/apply-review` derived zero edits, so there was nothing to undo.

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
