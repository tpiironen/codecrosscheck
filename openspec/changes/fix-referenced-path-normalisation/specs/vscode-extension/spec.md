# vscode-extension delta: fix-referenced-path-normalisation

## MODIFIED Requirements

### Requirement: /apply-review slash command

The participant SHALL accept `/apply-review [extra instructions]`. The
handler SHALL locate the most recent review transcript JSONL emitted
by `/review-branch`, extract the latest worker fix proposal, derive
concrete file edits from it via a worker LLM call returning
schema-validated edits, and apply each edit to the workspace. The
handler SHALL NOT modify files outside the workspace root and SHALL
NOT apply an edit whose `oldString` does not appear exactly once in
the target file.

Path directives in the fix proposal SHALL be normalised before use. In
addition to surrounding backticks, trailing parenthetical annotations and
trailing `:line` or `:line-line` suffixes, normalisation SHALL strip a trailing
`:symbol` suffix, because workers commonly cite a location as
`path/to/file.ts:functionName`. The symbol MAY carry call syntax, as reviewers
write locations such as `path/to/file.ts:someFunction().member`.

A referenced path that cannot denote a workspace file SHALL be reported as
unresolvable. It SHALL NOT be presented to the worker as a file that does not
exist yet, because that invites the creation of a phantom file and hides the
fact that the reference was malformed.

When no referenced path yields file content, the handler SHALL say so, so that
an empty edit set is explained rather than appearing as a silent no-op.

#### Scenario: Path directive annotated with a symbol

- **GIVEN** a fix proposal containing `// path: src/extension.ts:someFunction`
- **WHEN** `/apply-review` builds the file inventory
- **THEN** the inventory contains the contents of `src/extension.ts`
- **AND** no phantom file `src/extension.ts:someFunction` is proposed for
  creation

#### Scenario: Path directive annotated with a symbol in call syntax

- **GIVEN** a reference of the form
  `src/extension.ts:workspaceEditHost().commit`
- **WHEN** `/apply-review` builds the file inventory
- **THEN** the inventory contains the contents of `src/extension.ts`
- **AND** the parentheses do not prevent the suffix from being stripped

#### Scenario: Unresolvable reference is reported, not created

- **GIVEN** a referenced path that cannot denote a workspace file
- **WHEN** the file inventory is built
- **THEN** that path is reported as unresolvable
- **AND** it is not described to the worker as a file to create

#### Scenario: Empty inventory is explained

- **GIVEN** referenced paths none of which yield file content
- **WHEN** `/apply-review` runs
- **THEN** the handler reports that no source was available
- **AND** the resulting empty edit set is attributed to that cause

#### Scenario: Apply edits derived from latest transcript

- **GIVEN** a workspace where `/review-branch` has produced at least
  one transcript ending with a `review-branch-done` event
- **WHEN** the user sends `@codecrosscheck /apply-review`
- **THEN** the handler reads the newest matching transcript
- **AND** extracts the last `review-branch-iter` event with
  `role: "worker"` as the fix proposal
- **AND** calls the worker model with the apply prompt
- **AND** for each returned edit whose `path` resolves under the
  workspace root and whose `oldString` matches exactly once,
  performs the replacement via `vscode.workspace.fs`
- **AND** streams a per-edit applied/skipped report and a summary
  card recommending `git diff` and a follow-up `/review-branch`

#### Scenario: No transcript available

- **GIVEN** a workspace whose extension transcripts folder is empty
  or has no transcripts containing `review-branch-done`
- **WHEN** the user sends `@codecrosscheck /apply-review`
- **THEN** the handler streams a clear error message naming
  `/review-branch` as the prerequisite
- **AND** does NOT call any LLM
- **AND** does NOT write to any file

#### Scenario: Path escape attempt is rejected

- **GIVEN** a worker-derived edit whose `path` resolves outside the
  workspace root (e.g. `../../etc/passwd` or an absolute path)
- **WHEN** the handler validates the edit
- **THEN** the edit is skipped
- **AND** the report records `skipped: path outside workspace`
- **AND** no file is written

#### Scenario: Ambiguous or missing oldString

- **GIVEN** a worker-derived edit whose `oldString` is missing from
  the target file or appears more than once
- **WHEN** the handler attempts to apply it
- **THEN** the edit is skipped
- **AND** the report records `skipped: oldString not found` or
  `skipped: oldString matches N times`
- **AND** the original file is unchanged

#### Scenario: Dry-run mode

- **GIVEN** `codecrosscheck.applyReview.dryRun` is `true`
- **WHEN** the user sends `@codecrosscheck /apply-review`
- **THEN** the handler prints the planned edits (path, why, and a
  diff-style preview)
- **AND** does NOT write to any file
- **AND** does NOT run the test command

#### Scenario: Optional test command runs after edits

- **GIVEN** `codecrosscheck.applyReview.testCommand` is non-empty
  (e.g. `npm test`)
- **AND** at least one edit was applied
- **WHEN** edits complete
- **THEN** the handler creates a VS Code terminal named
  `CodeCrossCheck: apply-review tests`, sends the configured
  command, and includes the terminal name in the summary card
- **AND** does NOT parse or interpret the terminal output
