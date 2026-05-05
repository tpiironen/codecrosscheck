# Capability: vscode-extension (delta)

## ADDED Requirements

### Requirement: /apply-review slash command

The participant SHALL accept `/apply-review [extra instructions]`. The
handler SHALL locate the most recent review transcript JSONL emitted
by `/review-branch`, extract the latest worker fix proposal, derive
concrete file edits from it via a worker LLM call returning
schema-validated edits, and apply each edit to the workspace. The
handler SHALL NOT modify files outside the workspace root and SHALL
NOT apply an edit whose `oldString` does not appear exactly once in
the target file.

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

### Requirement: apply-review settings

The extension SHALL contribute two configuration settings under
`codecrosscheck.applyReview.*`:

- `testCommand` (string, default `""`) — shell command to run after
  edits in a dedicated terminal. Empty disables the test step.
- `dryRun` (boolean, default `false`) — when `true`, plan and print
  edits without writing to disk.

#### Scenario: Default settings

- **GIVEN** a fresh install with no user overrides
- **WHEN** `/apply-review` runs successfully and at least one edit
  is applied
- **THEN** no test command is invoked (default empty)
- **AND** edits are written to disk (default `dryRun=false`)

### Requirement: oldString safety-net repairs

The handler SHALL apply a deterministic sequence of repair variants
when a worker-derived edit's literal `oldString` does not match the
target file, and SHALL apply the first variant that matches uniquely.
The candidate set SHALL include, in order: the literal string;
CRLF/CR→LF normalisation; LF→CRLF normalisation (for CRLF source
files); a unified-diff stripped variant that drops one leading
`-` / `+` / space marker per line. The handler SHALL pair the
`newString` with the same repair (so a CRLF candidate emits a CRLF
replacement; a diff-stripped `oldString` is paired with a
diff-stripped `newString` using `+` and context lines). The handler
SHALL NOT enable any repair that loses information about the user's
file (e.g. silently re-encoding line endings outside the patched
region).

#### Scenario: Worker emitted LF text but the file uses CRLF

- **GIVEN** a target file whose lines are CRLF-terminated
- **AND** a worker edit whose `oldString` uses LF only
- **WHEN** the handler applies the edit
- **THEN** the LF→CRLF candidate matches uniquely
- **AND** the patched region is written with CRLF line endings,
  matching the surrounding file

#### Scenario: Worker copied a unified-diff hunk into oldString/newString

- **GIVEN** a worker edit whose `oldString` and `newString` both
  contain lines starting with `-`, `+`, or single-space markers
- **WHEN** the handler applies the edit
- **THEN** the diff-stripped variant of `oldString` (keeping
  `-` and ` ` lines, dropping the marker) matches the file uniquely
- **AND** the replacement is the diff-stripped `newString`
  (keeping `+` and ` ` lines)

#### Scenario: Empty oldString creates a new file

- **GIVEN** a worker edit with `oldString === ""`
- **AND** the resolved target path does NOT exist
- **WHEN** the handler applies the edit
- **THEN** parent directories are created
- **AND** `newString` is written as the full file content
- **AND** the outcome is `applied`

#### Scenario: Empty oldString refuses to overwrite an existing file

- **GIVEN** a worker edit with `oldString === ""`
- **AND** the resolved target path already exists
- **WHEN** the handler validates the edit
- **THEN** the edit is skipped with reason
  `file already exists (oldString empty implies create)`
- **AND** the file is unchanged

### Requirement: apply-review debug log

The handler SHALL persist a debug artifact at
`<workspace>/.codecrosscheck/runs/<iso>-apply.json` containing the
source transcript path, the iteration number, the harvested file
paths, the unreadable paths, the worker's raw `edits[]`, and the
per-edit `outcomes[]`. The log SHALL be written on every run
(including zero-edit runs), and the path SHALL be linked from the
chat output.

#### Scenario: Worker returned zero edits

- **GIVEN** a worker that produced a fix proposal containing only
  prose ("Data I need…") and no actionable hunks
- **WHEN** `/apply-review` derives edits and gets `[]`
- **THEN** a debug log is still written next to the source transcript
- **AND** the log contains `edits: []` and `outcomes: []`

### Requirement: review-branch repository file context

The extension SHALL harvest workspace-relative file paths before each
fixer iteration of `/review-branch` (iteration ≥ 2) from
(a) each reviewer finding's `where` and `suggestion` fields, and
(b) the worker's prior fix proposal (both `// path:` directives and
free-text mentions). The extension SHALL read the current contents
of those files (filtering out URLs, absolute Windows paths, and
host-prefixed paths) and inject them as a `# Repository file
context` section in the fixer input, capped at 60 000 characters.
The fixer system prompt SHALL describe this section as canonical
current source and SHALL forbid responding with
"I need the source" / "Data I need" placeholders when the file is
present in that section.

#### Scenario: Reviewer cites a file outside the branch diff

- **GIVEN** a reviewer finding whose `where` references a file not
  modified by the branch
- **WHEN** the fixer iteration runs
- **THEN** that file's current contents are included in the
  `# Repository file context` section
- **AND** the fixer produces a concrete unified-diff hunk against
  it rather than a "Data I need" placeholder

#### Scenario: Cited path is a URL or absolute path

- **GIVEN** a reviewer finding whose text mentions
  `https://example.com/foo.ts` or `C:/temp/bar.cs`
- **WHEN** path harvesting runs
- **THEN** neither path is included in the file context

### Requirement: review-branch worker-disagreement adjudication

The `/review-branch` fixer prompt SHALL allow the worker to push
back on a reviewer finding by writing `**Fix:** Disagree: <rebuttal>`
in that issue's section. The extension SHALL parse such rebuttals
out of the final fix proposal and render them at the end of the
chat output as a numbered, blockquoted decision block, accompanied
by an explanation of how the user adjudicates: accept by running
`/apply-review` (rebutted findings produce no edits, so nothing is
applied for them) or override by re-running `/review-branch` with
`force-fix-all` in the user prompt.

When the user prompt contains the token `force-fix-all` (matched as
a whole word, case-insensitive), the fixer input SHALL include a
`# User override` section, and the fixer prompt SHALL require a
concrete fix for every reviewer finding and forbid use of
`**Fix:** Disagree:` in that round.

#### Scenario: Worker rebuts one finding

- **GIVEN** the fixer wrote `**Fix:** Disagree: …` for issue 2 of 3
- **WHEN** `/review-branch` finishes
- **THEN** the chat output ends with a section titled
  `🤔 1 worker disagreement(s) pending your decision`
- **AND** that section quotes the rebuttal under the issue heading
- **AND** the section names both the accept path (`/apply-review`)
  and the override path (`force-fix-all` in the prompt)

#### Scenario: User overrides with force-fix-all

- **GIVEN** a previous `/review-branch` run produced a rebuttal
- **WHEN** the user re-runs with prompt
  `force-fix-all: address every finding`
- **THEN** the fixer input contains a `# User override` section
- **AND** the fixer's output contains no `**Fix:** Disagree:` lines
- **AND** every reviewer finding has a concrete fix section

### Requirement: review-branch blocked-finding detection

The extension SHALL also detect issue sections in the final fix
proposal where the worker dodged producing a concrete patch without
using the explicit `**Fix:** Disagree:` token, by matching dodge
patterns including `**Data I need`, `(sketch — pending current
source)`, `I cannot produce a patch/hunk`, and "pending source".
Such sections SHALL be rendered as a separate
`🚫 N finding(s) the worker did not produce a real patch for`
block at the end of the chat output, with a one-line reason per
issue and a remediation hint (open the parent multi-project folder
as the workspace, or re-run with `force-fix-all`). Issues already
captured by the disagreement adjudication block SHALL be excluded
to avoid double reporting.

#### Scenario: Worker emits a sketch instead of a patch

- **GIVEN** a fix proposal whose issue 1 says
  `**Fix:** I cannot produce the unified-diff hunk … without the
  current source` and includes
  `// path: foo.cs (sketch — pending current source)`
- **WHEN** `/review-branch` finishes
- **THEN** the summary contains the
  `🚫 1 finding(s) the worker did not produce a real patch for`
  block referencing issue 1
- **AND** the block names a remediation (workspace switch or
  `force-fix-all`)

#### Scenario: Disagreement and dodge are not double-reported

- **GIVEN** an issue whose body uses both `**Fix:** Disagree:` and
  the words "I cannot produce a patch"
- **WHEN** the summary renders
- **THEN** the issue appears in the disagreement block only
- **AND** the dodge block does not list it

### Requirement: review-branch summary discoverability

The `/review-branch` non-converged summary SHALL clarify that
residual reviewer findings target the **proposal**, not the
original branch (so the proposal itself may still contain
applicable patches). Whenever a final fix proposal exists
(converged or not), the summary SHALL print a line directing the
user to run `/apply-review` to apply the patches in the proposal,
followed (in the non-converged case) by guidance to re-run
`/review-branch` to address residual findings, raise
`codecrosscheck.maxIters`, or scope the prompt down. The
manual-only fallback SHALL render only when no fix proposal
exists at all.

#### Scenario: Did-not-converge summary still mentions /apply-review

- **GIVEN** `/review-branch` exits with a non-empty fix proposal
  but a `revise` verdict
- **WHEN** the summary renders
- **THEN** the summary contains
  `Note: the residual findings target the **proposal**, not the
  original branch`
- **AND** the summary contains a line starting with
  `**Next:** run \`/apply-review\``

### Requirement: review-branch reviewer exhaustiveness and complete-round rule

The `/review-branch` reviewer prompt SHALL require the reviewer
to list every finding it encounters, ordered by severity (`high`
first), then by file/line, with no arbitrary numeric cap. The
fixer prompt SHALL require each round's proposal to be complete
and self-contained: any hunk proposed in round N that is still
needed MUST be repeated verbatim in round N+1, since
`/apply-review` consumes only the final round.

#### Scenario: Reviewer finds many issues

- **GIVEN** a branch diff whose code legitimately contains 8 issues
  the reviewer can identify
- **WHEN** the reviewer judges the diff
- **THEN** the verdict's `issues` array contains all 8, ordered
  high → low → file/line

#### Scenario: Round 3 must repeat round-2 hunks still needed

- **GIVEN** a fix proposal where round 2 emitted a hunk for
  `Foo.cs` that the reviewer accepted, and round 3 has further
  findings on `Bar.cs`
- **WHEN** the worker writes the round-3 proposal
- **THEN** the round-3 proposal contains both the `Foo.cs` hunk
  (verbatim) and the new `Bar.cs` hunk
- **AND** `/apply-review` applies edits for both files

### Requirement: review-branch per-invocation max-iters

The `/review-branch` handler SHALL accept a `max-iters=N` (or
`maxiters=N` or `iters=N`) token in the user prompt to override
`codecrosscheck.maxIters` for that invocation only. The token
SHALL match whole-word, case-insensitively, accept N in the range
1..20, and leave the configured setting unchanged.

#### Scenario: Prompt overrides setting

- **GIVEN** `codecrosscheck.maxIters` is 3
- **WHEN** the user runs
  `@codecrosscheck /review-branch max-iters=6`
- **THEN** the run is capped at 6 iterations
- **AND** the configured setting remains 3 for subsequent runs

#### Scenario: Out-of-range token is ignored

- **GIVEN** `codecrosscheck.maxIters` is 3
- **WHEN** the user runs
  `@codecrosscheck /review-branch iters=99`
- **THEN** the cap stays at 3
