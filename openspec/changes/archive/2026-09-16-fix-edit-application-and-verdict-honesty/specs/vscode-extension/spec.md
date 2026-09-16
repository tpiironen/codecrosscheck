# vscode-extension spec delta

## ADDED Requirements

### Requirement: Applied edits SHALL be written byte-for-byte

`/apply-review` SHALL write `newString` into the target file exactly as the
worker produced it. The replacement SHALL NOT be interpreted for `$`
substitution patterns, HTML entities, or any other escape convention.

Implementations SHALL NOT use `String.prototype.replace` with a string
search value for this purpose, because `GetSubstitution` expands `$$`, `$&`,
`` $` `` and `$'` in the replacement regardless of the search value's type.
Because `applyEdit` has already established that `oldString` matches exactly
once, splicing on `indexOf` is both sufficient and unambiguous.

#### Scenario: Replacement containing the whole-match pattern is written literally

- **WHEN** an edit's `newString` contains `$&`
- **THEN** the file on disk contains the literal characters `$&` and NOT the
  text that `oldString` matched

#### Scenario: Replacement containing prefix, suffix and escape patterns is written literally

- **WHEN** an edit's `newString` contains any of `` $` ``, `$'`, or `$$`
- **THEN** the file on disk contains those characters literally, and the
  outcome is reported as `applied`

#### Scenario: Ordinary replacements are unaffected

- **WHEN** an edit's `newString` contains no `$` character
- **THEN** the resulting file content is identical to the previous
  implementation's output

### Requirement: Applied edits SHALL be undoable and SHALL respect open editors

`/apply-review` SHALL apply its edits through `vscode.workspace.applyEdit` so
the whole batch lands as one entry on the undo stack and a single undo reverts
the run.

Writing directly to disk bypasses the editor's document model: edits made
under a dirty buffer produce a file-changed-on-disk conflict, and the user has
no undo path for a batch of model-authored changes. Path validation, existence
checks, and occurrence counting remain unchanged; only the write mechanism
does.

When no workspace edit host is available — the CLI, or tests — the
implementation SHALL fall back to the injected filesystem.

#### Scenario: A batch of edits undoes in one step

- **WHEN** `/apply-review` applies three edits across two files
- **THEN** a single undo reverts all three

#### Scenario: Edits apply to a file with unsaved changes

- **WHEN** a target file has unsaved editor changes and an edit applies to it
- **THEN** the edit is applied to the document rather than overwriting it on
  disk, and no file-changed-on-disk conflict is raised

#### Scenario: Dry run writes nothing

- **WHEN** `/apply-review` runs with `dryRun` enabled
- **THEN** no workspace edit is applied and no file is written

### Requirement: A suppressed-findings exit SHALL NOT be reported as approval

`/review-branch` SHALL track how its dialogue terminated and SHALL
distinguish at least three outcomes:

- `approved` — the reviewer returned `verdict: "approve"` on its own.
- `rebutted` — the loop ended because every remaining finding matched a
  fingerprint the worker had previously rebutted.
- `exhausted` — the iteration cap was reached with findings outstanding.

The summary SHALL render `rebutted` distinctly from `approved`, SHALL NOT use
the approval icon or the phrase "Reviewer is satisfied" for it, and SHALL
state that the outstanding findings await user adjudication.

#### Scenario: Reviewer approves on its own

- **WHEN** the reviewer returns `verdict: "approve"` with no rebuttal
  filtering applied
- **THEN** the summary reports approval and attributes it to the reviewer

#### Scenario: All findings suppressed by worker rebuttals

- **WHEN** every outstanding finding matches a fingerprint the worker rebutted
  in an earlier round, so the filtered issue list is empty
- **THEN** the summary SHALL NOT claim the reviewer approved, and SHALL
  direct the user to the listed rebuttals for adjudication

#### Scenario: Iteration cap reached with findings outstanding

- **WHEN** the loop reaches `maxIters` while the reviewer still reports issues
  that were not suppressed
- **THEN** the summary reports non-convergence, unchanged from current
  behaviour

### Requirement: Rejected-issue filtering SHALL be side-effect free

`filterRejectedIssues` SHALL return a description of what it filtered rather
than deciding the verdict on the caller's behalf. It SHALL NOT mutate the
verdict it was given, and SHALL NOT reach a `"approve"` value through a type
assertion that bypasses the declared generic.

#### Scenario: Filtering reports an emptied issue list without asserting approval

- **WHEN** filtering removes every issue from the verdict
- **THEN** the return value signals that the list was emptied by suppression,
  and the caller decides how to terminate and how to report it

#### Scenario: Input verdict is not mutated

- **WHEN** `filterRejectedIssues` drops one or more issues
- **THEN** the verdict object passed in is unchanged, and the returned
  verdict is a distinct object
