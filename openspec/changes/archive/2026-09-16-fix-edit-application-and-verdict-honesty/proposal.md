# Fix edit application and verdict honesty

## Why

Two defects in the `/review-branch` → `/apply-review` chain produce silently
wrong results rather than visible failures.

**1. `/apply-review` corrupts edits containing `$` substitution patterns.**
`applyEdit` writes the new file content with
`original.replace(matchedOld, repairedNew)`. `String.prototype.replace` runs
the `GetSubstitution` algorithm on the replacement string *even when the
search value is a plain string*, so `$&`, `` $` ``, `$'` and `$$` in
`newString` are expanded instead of written literally. Measured:

| `newString` | written to disk | intended |
|---|---|---|
| `x$&y` | `xMARKy` | `x$&y` |
| ``p$`q`` | `pAAA q` | ``p$`q`` |
| `p$'q` | `p ZZZq` | `p$'q` |
| `cost $$5` | `cost $5` | `cost $$5` |

The edit is reported with `status: "applied"` and no warning. Real triggers
are common: Makefile and shell `$$`, bash `$'…'` quoting, JavaScript or C#
source that itself calls `.replace(…, "$&")`, and documentation about regex
replacement syntax. `$1` happens to be safe (no capture groups exist for a
string search value), which makes the failure mode look arbitrary.

**2. `/review-branch` reports reviewer approval the reviewer never gave.**
When the worker rebuts findings with `**Fix:** Disagree:`, their fingerprints
are recorded and `filterRejectedIssues` drops matching findings from later
verdicts. If that empties the issue list, the helper flips the verdict to
`approve`, the loop exits, and the summary prints
"✅ **Approved** … Reviewer is satisfied with the worker's fix proposal."

The reviewer was never satisfied — the *worker* suppressed the findings by
disagreeing with them. For a tool whose entire premise is that a second model
independently judges the first, a path where the produced-by model can
self-certify is a correctness defect, not a presentation nit. The rebuttals
are already surfaced for user adjudication further down the summary, which
directly contradicts the green check above them.

**3. Applied edits are not undoable.** `applyEdits` writes each file with
`fs.writeFile` in sequence. A failure partway leaves a half-applied tree with
no rollback, the changes never reach the editor's undo stack, and writing
under a dirty buffer raises a file-changed-on-disk conflict. A batch of
model-authored edits is exactly the case where a user wants one Ctrl+Z.

## What Changes

- **MODIFIED capability `vscode-extension`**: `/apply-review` SHALL splice
  replacement text into the file by index rather than routing it through
  `String.prototype.replace`, so `newString` is written byte-for-byte.
- **MODIFIED capability `vscode-extension`**: `/apply-review` SHALL apply its
  edits through `vscode.workspace.applyEdit` so the batch is one undo step and
  files with unsaved changes are edited rather than overwritten on disk.
- **MODIFIED capability `vscode-extension`**: `/review-branch` SHALL
  distinguish a reviewer-issued `approve` from a loop that terminated only
  because every outstanding finding was suppressed by worker rebuttals. The
  latter SHALL NOT be presented as approved.
- **MODIFIED capability `vscode-extension`**: `filterRejectedIssues` SHALL
  report *why* the issue list emptied instead of silently rewriting the
  verdict, and SHALL stop mutating its argument through a type assertion.

## Impact

- Affected specs: `vscode-extension`.
- Affected code: `src/applyReview.ts`, `src/extension.ts`.
- Affected tests: `test/applyReview.test.ts` (new `$`-substitution cases, new
  `filterRejectedIssues` outcome cases, edit-host cases).
- User-visible change: edits containing `$&`/`` $` ``/`$'`/`$$` now land
  correctly; an `/apply-review` run is a single undo; `/review-branch` no
  longer claims approval when the worker talked its way out of every finding.
