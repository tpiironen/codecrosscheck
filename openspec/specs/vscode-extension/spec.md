# vscode-extension Specification

## Purpose
TBD - created by archiving change add-codecrosscheck. Update Purpose after archive.
## Requirements
### Requirement: Chat participant registration

The extension SHALL register a chat participant with id `codecrosscheck` that drives the review loop using two distinct Copilot models selected via `vscode.lm`.

#### Scenario: Participant appears in Copilot Chat

- **WHEN** the extension activates in a workspace with Copilot Chat available
- **THEN** typing `@codecrosscheck` in the chat input shows the participant in the suggestion list

#### Scenario: Two distinct models in trace

- **WHEN** the participant runs a stage that requires at least one revision
- **THEN** the streamed chat output shows the worker model name AND the reviewer model name
- **AND** the two names differ when defaults are used

### Requirement: Slash commands

The participant SHALL accept slash commands `/plan`, `/code`, and `/execute` that restrict the pipeline to a single stage. An invocation with no slash command SHALL run all three stages in order.

#### Scenario: /plan restricts to PLAN stage only

- **WHEN** the user sends `@codecrosscheck /plan add caching to /products`
- **THEN** only the PLAN stage runs
- **AND** no CODE or EXECUTE output appears in the chat

### Requirement: Streaming output

The participant SHALL stream loop events to the chat as they occur, including the worker artifact, the reviewer's JSON verdict, and revision rounds. The final message SHALL include `approved`, `iterations`, and a clickable link to the JSONL transcript.

#### Scenario: Per-iteration visibility

- **GIVEN** a run that takes two iterations to converge
- **WHEN** the run completes
- **THEN** the chat shows iteration-1 worker output, iteration-1 reviewer verdict, iteration-2 worker output, iteration-2 reviewer verdict, AND the final summary in that order

### Requirement: Editor commands

The extension SHALL register two Command Palette commands — `CodeCrossCheck: Review Selection` and `CodeCrossCheck: Review Active File` — that invoke ONLY the code reviewer (no worker, no loop) on the supplied text and present the issues in a webview.

#### Scenario: Review Selection on flagged code

- **GIVEN** an active editor with a selected SQL-injection-prone line
- **WHEN** the user runs `CodeCrossCheck: Review Selection`
- **THEN** the reviewer is invoked with only the selection
- **AND** the resulting issues are displayed in a webview within the editor
- **AND** the worker is not invoked

### Requirement: VS Code settings

The extension SHALL contribute the following settings under the `codecrosscheck.*` namespace, each with a default value AND a user-visible description:

- `codecrosscheck.workerModel`
- `codecrosscheck.reviewerModel`
- `codecrosscheck.maxIters`
- `codecrosscheck.execute.timeoutMs`
- `codecrosscheck.execute.allowNetwork`

#### Scenario: Setting overrides default model

- **GIVEN** `codecrosscheck.workerModel` is set to `openai/gpt-4.1` in workspace settings
- **WHEN** the participant builds the worker client
- **THEN** the worker uses the `openai/gpt-4.1` model family

### Requirement: In-extension sandbox

The `/execute` flow SHALL invoke `runSandboxed` from `src/sandbox.ts` directly within the extension host process. The extension SHALL NOT shell out to a Python or other external runner for execution.

#### Scenario: Sandboxed execution from chat

- **WHEN** the user sends `@codecrosscheck /execute <task>` with a generated code artifact
- **THEN** the sandbox runs in the extension host
- **AND** stdout, stderr, and exitCode are captured and shown in chat

### Requirement: Quota and missing-model handling

When `vscode.lm.selectChatModels` returns no matching model (quota exhausted or family unavailable), the participant SHALL emit a chat error that names the requested family AND suggests a fallback, AND SHALL NOT silently fail.

#### Scenario: Unavailable family produces actionable error

- **GIVEN** `codecrosscheck.workerModel` is set to a family not currently available
- **WHEN** the participant tries to build the worker client
- **THEN** the chat shows an error mentioning the family name AND a suggestion to update the setting

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

The character budget SHALL be allocated across the cited files rather than
applied as a single prefix cut over their concatenation. Every cited file that
resolves to readable content SHALL be represented in the block. A file SHALL NOT
be omitted merely because an earlier file consumed the budget.

Where a file's contents are shorter than its share of the budget, the unused
remainder SHALL be made available to the remaining files.

Where a file cannot be included whole, it SHALL be truncated individually and
its header SHALL state that it is partial. The retained portion SHALL include
both the beginning and the end of the file, with the elision marked, because a
finding may cite a symbol anywhere in the file.

#### Scenario: Cited file larger than the whole budget

- **GIVEN** two cited files, the first of which alone exceeds the budget
- **WHEN** the file context block is built
- **THEN** both files appear in the block
- **AND** the first is marked as partial rather than silently cut

#### Scenario: Small file is not padded out

- **GIVEN** a cited file far smaller than its equal share of the budget
- **WHEN** the file context block is built
- **THEN** that file appears in full
- **AND** the share it did not use is available to the other cited files

#### Scenario: Truncation preserves the end of the file

- **GIVEN** a cited file that must be truncated
- **WHEN** it is added to the block
- **THEN** the retained text includes the start and the end of the file
- **AND** the omission between them is explicitly marked

#### Scenario: Everything fits

- **GIVEN** cited files whose combined size is within the budget
- **WHEN** the block is built
- **THEN** every file appears in full and none is marked partial

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

### Requirement: Chat-picker worker model

The chat participant SHALL respect the model selected in Copilot Chat's
model picker as the worker model when the setting
`codecrosscheck.useChatPickerWorker` is `true` (the default). The reviewer
SHALL always resolve from `codecrosscheck.reviewerModel` regardless of this
setting, preserving the cross-vendor invariant. When the resolved worker
and reviewer model ids are identical, the participant SHALL stream a
warning message before running the loop.

#### Scenario: Picker selection is honoured

- **GIVEN** `codecrosscheck.useChatPickerWorker` is `true`
- **AND** the user has selected `claude-sonnet-4` in the Copilot Chat picker
- **WHEN** the user sends `@codecrosscheck /plan ...`
- **THEN** the worker uses `claude-sonnet-4`
- **AND** the reviewer still uses `codecrosscheck.reviewerModel`

#### Scenario: Setting disabled

- **GIVEN** `codecrosscheck.useChatPickerWorker` is `false`
- **WHEN** the user sends `@codecrosscheck /plan ...`
- **THEN** the worker uses `codecrosscheck.workerModel` regardless of the
  picker selection

#### Scenario: Worker == reviewer collision warning

- **GIVEN** the resolved worker and reviewer model ids are identical
- **WHEN** the participant starts the loop
- **THEN** a warning is streamed to the chat naming both ids before any
  loop output

### Requirement: /review-branch slash command

The participant SHALL accept `/review-branch [extra instructions]`. The
handler SHALL compute the current branch diff against the merge-base
with `origin/main` (or `HEAD` if no remote tracking ref is found) and
run a reviewer-first dialogue loop. Iteration 1 SHALL be a single
CODE-reviewer pass on the diff; iterations 2..N SHALL invoke the
worker to produce a fix proposal addressing every reviewer finding,
followed by a reviewer re-judgement of whether those fixes resolve
the prior findings without introducing new issues. The loop SHALL
terminate when the reviewer returns `approve` or when
`codecrosscheck.maxIters` is reached. The handler SHALL NOT delegate
to `runPipeline` or to the PLAN stage.

#### Scenario: Branch diff is reviewed and fixes proposed

- **GIVEN** a branch with committed changes ahead of `origin/main`
- **WHEN** the user sends `@codecrosscheck /review-branch focus on auth`
- **THEN** iteration 1 streams a reviewer verdict citing file:line
  findings on the diff
- **AND** iteration 2 streams a worker-authored fix proposal whose
  sections correspond one-for-one to the reviewer findings
- **AND** iteration 2 also streams a reviewer re-judgement of the
  proposal
- **AND** the chat output streams a clickable transcript link

#### Scenario: Loop terminates on approval

- **GIVEN** the reviewer returns `approve` after iteration N
- **WHEN** the loop checks the verdict
- **THEN** further iterations SHALL NOT run
- **AND** the summary card SHALL show
  `✅ Approved after N iteration(s)`

#### Scenario: Loop terminates on iteration cap

- **GIVEN** the reviewer keeps returning `revise` through
  `codecrosscheck.maxIters` iterations
- **WHEN** the cap is reached
- **THEN** the handler SHALL emit a summary card containing severity
  counts of remaining issues, the latest worker fix proposal in full,
  total elapsed time, and explicit next-steps guidance
  (raise `maxIters`, scope the prompt, or take the proposal as a
  starting point)

#### Scenario: No remote tracking ref

- **GIVEN** a workspace where `origin/main` cannot be resolved
- **WHEN** the user sends `@codecrosscheck /review-branch`
- **THEN** the handler falls back to `HEAD` as the base and proceeds

### Requirement: Install-delegation-skill command

The extension SHALL register a Command Palette entry
`CodeCrossCheck: Install Delegation Skill` (command id
`codecrosscheck.installSkill`) that copies the bundled `codecrosscheck-delegate`
skill from the extension's `dist/assets/skills/` to one of two destinations
chosen by the user via QuickPick:

- **Workspace**: `<workspace>/.github/skills/codecrosscheck-delegate/SKILL.md`
- **User**: `<homedir>/.agents/skills/codecrosscheck-delegate/SKILL.md`

The command SHALL refuse to overwrite an existing destination without
explicit user confirmation, SHALL surface a clear error if no workspace is
open and Workspace scope is selected, and SHALL show an information message
on success that reminds the user to reload the chat extension or restart
VS Code.

#### Scenario: Workspace install

- **GIVEN** a workspace folder is open
- **AND** `<workspace>/.github/skills/codecrosscheck-delegate/SKILL.md` does
  not exist
- **WHEN** the user runs the command and picks "Workspace"
- **THEN** the bundled skill is written to that path
- **AND** an information message is shown telling the user to reload

#### Scenario: User install

- **WHEN** the user runs the command and picks "User"
- **THEN** the bundled skill is written to
  `<homedir>/.agents/skills/codecrosscheck-delegate/SKILL.md`

#### Scenario: Overwrite refusal

- **GIVEN** the destination file already exists
- **WHEN** the user runs the command
- **THEN** the user is shown a modal warning and the file is only
  overwritten if the user confirms

### Requirement: VSIX bundles the delegation skill

The build pipeline SHALL bundle `.github/skills/codecrosscheck-delegate/`
into `dist/assets/skills/codecrosscheck-delegate/` so the skill ships
inside the VSIX and inside the npm tarball. The `package.json` `files`
whitelist SHALL include `dist/`.

#### Scenario: Built artifact contains the skill

- **WHEN** `npm run build` completes
- **THEN** `dist/assets/skills/codecrosscheck-delegate/SKILL.md` exists
- **AND** `vsce package --allow-package-secrets` includes that path

### Requirement: Final summary card on every chat-participant flow

Every `@codecrosscheck` flow that runs a worker↔reviewer loop SHALL
end with a summary card containing: an outcome banner
(`✅ Approved` or `⚠️ Did not converge`), total iterations,
elapsed time in seconds, severity counts of any remaining issues
(high / medium / low), the final artifact rendered in full inside an
HTML `<details>` block, and a clickable transcript link. When the
outcome is "did not converge", the card SHALL also include
next-steps guidance.

#### Scenario: Approved run

- **GIVEN** a flow that converges on iteration 2 of 3
- **WHEN** the loop exits with `approved=true`
- **THEN** the chat shows
  `✅ Approved after 2 iteration(s) ... in <X>s`
- **AND** the final artifact is rendered in an open `<details>` block

#### Scenario: Cap-reached run

- **GIVEN** a flow that exhausts `maxIters` without approval
- **WHEN** the loop exits with `approved=false`
- **THEN** the chat shows the warning banner with severity counts
- **AND** the final artifact is rendered in a closed `<details>` block
- **AND** the next-steps guidance text is visible

### Requirement: Live agent-status streaming

The chat participant SHALL stream progress incrementally during a
flow. For each iteration, the handler SHALL emit a header
`Iteration <N> / <maxIters>`, call `stream.progress(...)` while the
worker or reviewer call is in flight, and render the worker artifact
and reviewer verdict as soon as each call returns. Reviewer issues
SHALL be grouped by severity (high / medium / low) with corresponding
🔴 / 🟡 / 🔵 icons.

#### Scenario: Live progress during long calls

- **GIVEN** a worker or reviewer call that takes more than a few
  seconds
- **WHEN** the call is in flight
- **THEN** the chat shows a `stream.progress(...)` indicator naming
  the model and the action ("drafting fixes", "reading diff",
  "checking fixes")

### Requirement: /review-branch SHALL bail before calling the LM when the diff is too large

The `/review-branch` participant command SHALL apply a hard char-budget guard
on the assembled branch diff before any reviewer LM call. The cap SHALL be
governed by the VS Code setting
`codecrosscheck.reviewBranch.maxDiffChars` (integer, default `1100000`,
minimum `0`; `0` disables the guard).

When the diff exceeds the cap, the handler SHALL print a clear chat message
that includes the actual diff size, the configured cap, and at minimum the
following remedies: pass a closer `diff-base=<ref>`, split the branch, or
raise the cap if the reviewer model is known to handle it. The handler SHALL
return without invoking the reviewer.

This guard is independent of the reviewer model — it protects against the
common case where a forgotten `diff-base` produces a multi-megabyte diff that
no reasonable LM can review in one pass. Because the default cap is larger
than the context window of any currently reachable reviewer model, the token
preflight is normally the gate that fires first; this guard remains the only
protection for models that report no `maxInputTokens`.

#### Scenario: Diff over the configured cap aborts before the LM call

- **WHEN** the user runs `@codecrosscheck /review-branch` and the assembled
  branch diff is larger than `codecrosscheck.reviewBranch.maxDiffChars`
- **THEN** the handler prints an error message containing the actual diff
  size, the cap, and `diff-base=` guidance, and SHALL NOT call the reviewer
  LM

#### Scenario: maxDiffChars=0 disables the guard

- **WHEN** `codecrosscheck.reviewBranch.maxDiffChars` is `0`
- **THEN** the char-budget guard is skipped regardless of diff size (the
  token preflight may still abort the run)

### Requirement: /review-branch SHALL run a best-effort token preflight on the reviewer model

The `/review-branch` participant command SHALL run a best-effort token
preflight on the assembled reviewer prompt before calling the reviewer LM.
When the reviewer model exposes `countTokens(text)` and `maxInputTokens`
(VS Code 1.93+ `LanguageModelChat`), the handler SHALL measure the prompt
and abort with a typed chat message when the prompt would consume more than
90% of `maxInputTokens` (the remaining 10% is reserved for the response).

The preflight SHALL be best-effort: if the model does not expose the API,
`countTokens` throws, or the VS Code module cannot be imported, the
preflight SHALL be skipped silently and the normal call path runs.

The abort message SHALL include the measured token count, the budget, the
reviewer model id, and remediation guidance (`diff-base=<ref>`, pick a
larger reviewer via `codecrosscheck.reviewerModel`, or split the branch).

#### Scenario: Prompt exceeding 90% of maxInputTokens aborts

- **WHEN** the reviewer model reports `maxInputTokens = 100000` and
  `countTokens(prompt)` returns `95000`
- **THEN** `/review-branch` prints an abort message naming the token count
  and budget and SHALL NOT call `reviewer.judge`

#### Scenario: countTokens unavailable falls through silently

- **WHEN** the reviewer model has no `countTokens` method (or it throws)
- **THEN** the preflight is skipped without surfacing an error and the
  reviewer call proceeds normally

#### Scenario: Prompt under budget proceeds normally

- **WHEN** `countTokens(prompt)` returns a value at or below
  `floor(maxInputTokens * 0.9)`
- **THEN** the preflight passes and `reviewer.judge` is called with the
  assembled prompt

### Requirement: review-branch re-review diff scoping

The extension SHALL scope the branch diff sent to the reviewer on re-review
passes (iteration ≥ 2) of `/review-branch` to only those files cited by the
prior findings and by the worker's fix proposal. The cited paths SHALL be the
same set already harvested for the fixer's repository file context, derived
from each finding's `where` and `suggestion` fields and from the fix proposal.

The initial review pass SHALL continue to receive the complete branch diff.

When the scoped patch is empty — because no cited path matched a file in the
diff — the extension SHALL send the complete diff instead. Scoping SHALL NOT
be allowed to reduce the reviewer's context to nothing.

The re-review prompt SHALL state that the diff has been scoped and SHALL report
how many files were omitted, so the reviewer is not misled into treating the
scoped diff as the whole branch.

The extension SHALL record the scoping outcome in the re-review
`review-branch-iter` transcript event, including the number of characters sent,
the number of files included and the number omitted.

#### Scenario: Findings cite a subset of the changed files

- **GIVEN** a branch diff touching ten files
- **AND** a prior verdict whose findings cite two of them
- **WHEN** the re-review prompt is built
- **THEN** the diff in the prompt contains only those two files
- **AND** the prompt states that eight files were omitted

#### Scenario: No cited path matches the diff

- **GIVEN** a prior verdict whose findings cite no path present in the diff
- **WHEN** the re-review prompt is built
- **THEN** the complete branch diff is sent
- **AND** the prompt does not claim that any file was omitted

#### Scenario: Initial pass is unaffected

- **WHEN** the first reviewer call of `/review-branch` is made
- **THEN** it receives the complete branch diff regardless of any scoping

#### Scenario: Scoping is measurable from the transcript

- **WHEN** a re-review pass completes
- **THEN** its `review-branch-iter` transcript event records the characters
  sent and the counts of included and omitted files

### Requirement: Transcript durability before handler return

Handlers that write a terminal transcript event SHALL wait for every queued
transcript write to reach disk before returning control to the user. The
terminal events are `review-branch-done` for `/review-branch` and
`/openspec-review`, and `completed` for the pipeline handler.

The transcript writer SHALL expose a `flush()` operation that resolves only
once all queued appends have completed.

The writer SHALL NOT silently discard append failures. It SHALL retain the
first failure and report it from `flush()`.

When `flush()` reports a failure, the handler SHALL warn the user that the
transcript is incomplete, and SHALL NOT fail the run on that basis. A review
that produced a verdict has succeeded regardless of whether its record was
written.

`write()` SHALL remain synchronous and non-blocking so that emitting an event
never stalls the extension host.

#### Scenario: Apply immediately after review

- **GIVEN** a `/review-branch` run that has just returned
- **WHEN** `/apply-review` runs immediately, before any further user action
- **THEN** the transcript already contains the `review-branch-done` event
- **AND** `/apply-review` locates it rather than reporting no transcript

#### Scenario: Append failure is surfaced

- **GIVEN** a transcript whose underlying append fails
- **WHEN** the handler flushes before returning
- **THEN** the user is warned that the transcript is incomplete
- **AND** the review's verdict and fix proposal are still reported normally

#### Scenario: Emitting an event does not block

- **WHEN** a handler writes a transcript event mid-run
- **THEN** the call returns without awaiting disk I/O

### Requirement: review-branch SHALL triage findings before drafting fixes

`/review-branch` SHALL run triage on the reviewer's findings before the worker
drafts any fix, and SHALL pass only findings whose triage status is `confirmed`
to the fix-drafting step.

Findings with status `rejected` or `uncertain` SHALL be reported to the user
with their evidence, and SHALL NOT produce fix text. A finding the worker
cannot support must not become an edit.

The triage step SHALL receive the repository file context already harvested for
the cited paths, so that it judges against current source rather than from the
finding's wording alone.

When the `force-fix-all` directive is present, triage SHALL be bypassed and
every finding SHALL be treated as confirmed. The directive exists for the user
to overrule the worker.

When every finding is rejected, `/review-branch` SHALL report that the code was
defended against the findings, and SHALL NOT report the run as an approved fix
proposal. These are different outcomes and conflating them hides the result the
user most needs.

The extension SHALL record triage results in a `review-branch-triage`
transcript event, including each finding's id, status and evidence.

#### Scenario: A rejected finding never reaches the fixer

- **GIVEN** a reviewer verdict with two findings
- **AND** triage rejects one of them with evidence
- **WHEN** the fix-drafting step runs
- **THEN** it receives only the confirmed finding
- **AND** the rejected finding is shown to the user with its evidence

#### Scenario: Every finding rejected

- **GIVEN** a reviewer verdict whose findings are all rejected by triage
- **WHEN** the iteration completes
- **THEN** the run reports that the code was defended
- **AND** no fix proposal is presented for application

#### Scenario: force-fix-all overrules triage

- **GIVEN** a user prompt containing `force-fix-all`
- **WHEN** `/review-branch` runs
- **THEN** triage does not run
- **AND** every finding is drafted against

#### Scenario: Triage is recorded for later steps

- **WHEN** a triage step completes
- **THEN** a `review-branch-triage` transcript event records each finding's id,
  status and evidence

### Requirement: Command-executing settings SHALL NOT be workspace-overridable

Any setting whose value is executed as a command SHALL be contributed with
`"scope": "machine"` so a workspace `.vscode/settings.json` cannot supply it.
This applies to `codecrosscheck.applyReview.buildCommand`,
`codecrosscheck.applyReview.testCommand`, and any future setting with the same
property.

The extension manifest SHALL additionally declare
`capabilities.untrustedWorkspaces` explicitly rather than relying on the
absence of the field to imply `supported: false`.

#### Scenario: Workspace settings cannot supply a build command

- **WHEN** a workspace `.vscode/settings.json` sets
  `codecrosscheck.applyReview.buildCommand`
- **THEN** the value is not returned to the extension, and `/apply-review`
  behaves as though no build command is configured

#### Scenario: Manifest states its trust posture

- **WHEN** the extension manifest is inspected
- **THEN** it contains a `capabilities.untrustedWorkspaces` entry with an
  explicit `supported` value and a description

### Requirement: Command execution SHALL require a trusted workspace

`/apply-review` SHALL check `vscode.workspace.isTrusted` before running a
configured build or test command. When the workspace is not trusted the
handler SHALL skip both steps and SHALL say so in chat rather than failing
silently.

#### Scenario: Untrusted workspace skips the build gate

- **WHEN** `/apply-review` applies edits in a workspace that is not trusted
  and a build command is configured
- **THEN** the command is not executed and the chat output states that command
  execution requires a trusted workspace

#### Scenario: Trusted workspace runs the gate as before

- **WHEN** the workspace is trusted and a build command is configured
- **THEN** the build gate runs and reports its exit code as before

### Requirement: The transcript directory SHALL be self-ignoring and bounded

On creating the transcript directory the extension SHALL ensure a
`.gitignore` exists inside it that ignores the directory's own contents, so a
consumer repository cannot commit review transcripts by accident.

The extension SHALL prune transcripts beyond a retention limit, oldest first,
so the directory does not grow without bound.

#### Scenario: Transcript directory ignores itself on creation

- **WHEN** the transcript directory is created for the first time in a
  workspace
- **THEN** it contains a `.gitignore` whose rules exclude the transcripts from
  version control

#### Scenario: Old transcripts are pruned

- **WHEN** the number of transcripts exceeds the retention limit
- **THEN** the oldest transcripts beyond the limit are deleted and the newest
  are retained

### Requirement: Transcript discovery SHALL NOT scan whole files

`findLatestTranscript` SHALL identify the newest completed transcript without
reading every candidate file in full. Because the terminating event is the
last record written, inspecting the tail is sufficient.

Detection SHALL match a parsed terminating event rather than a raw substring.
A substring test over the whole file matches any worker artifact that merely
quotes the event name — including a review of this codebase.

Transcript writes SHALL NOT block the extension host with synchronous
filesystem calls for every event.

#### Scenario: An artifact quoting the event name is not mistaken for a completed run

- **WHEN** a transcript's worker artifact text contains the terminating event
  name but the run never completed
- **THEN** that transcript is not selected as the latest completed one

#### Scenario: The newest completed transcript is selected

- **WHEN** several transcripts exist and more than one completed
- **THEN** the most recently modified completed transcript is returned

#### Scenario: Event writes do not block the host

- **WHEN** a run writes transcript events
- **THEN** the writes are performed without synchronous filesystem calls on the
  extension host

### Requirement: The verdict webview SHALL restrict its own capabilities

The verdict webview SHALL declare `localResourceRoots: []` and SHALL emit a
`Content-Security-Policy` meta tag that denies scripts and restricts every
other directive to `'none'` except inline styles. This applies to the webview
created by `codecrosscheck.reviewSelection` and
`codecrosscheck.reviewActiveFile`.

Model-produced text rendered into that document SHALL continue to be HTML
escaped.

#### Scenario: Webview denies script execution

- **WHEN** the verdict webview is opened
- **THEN** its HTML contains a Content-Security-Policy meta tag with
  `default-src 'none'` and no `script-src` permitting execution

#### Scenario: Model text is escaped

- **WHEN** a verdict field contains `<script>` or `&`
- **THEN** the rendered HTML contains the escaped entity form, not live markup

### Requirement: Chat handlers SHALL honour the request cancellation token

Every chat request handler SHALL pass the `CancellationToken` it receives into
the work it starts, so that stopping the response stops the underlying model
calls. No handler SHALL discard the token.

A cancelled run SHALL be reported distinctly from an approved, rebutted, or
exhausted one, and SHALL still link the transcript written so far.

#### Scenario: Stopping the response stops the loop

- **WHEN** the user cancels a `/review-branch` response mid-dialogue
- **THEN** no further worker or reviewer call is issued

#### Scenario: Cancelled runs are reported as cancelled

- **WHEN** a run is cancelled
- **THEN** the summary states the run was cancelled, reports how many
  iterations completed, and links the transcript

#### Scenario: Cancellation is recorded in the transcript

- **WHEN** a run is cancelled
- **THEN** the terminating transcript event records the cancelled outcome

### Requirement: Configuration SHALL have a single source of defaults

All `codecrosscheck.*` settings SHALL be read through one module that declares
exactly one default per setting. Handlers SHALL NOT restate defaults inline.

The declared defaults SHALL match the values contributed in the extension
manifest. A test SHALL assert that agreement so the two cannot drift.

Dead routing entries SHALL be removed; a command that returns before the stage
list is read SHALL NOT appear in the stage map.

#### Scenario: Reviewer fallback is not the worker's default

- **WHEN** configuration resolution is inspected for any handler
- **THEN** the reviewer default is the configured cross-vendor reviewer family
  and never the worker's default family

#### Scenario: Manifest and code defaults agree

- **WHEN** the settings contributed in the manifest are compared with the
  defaults declared in the configuration module
- **THEN** every shared key has an identical default value

#### Scenario: Iteration cap has one default

- **WHEN** `maxIters` is resolved with no user configuration present
- **THEN** every surface — chat participant, CLI, and documentation — reports
  the same value

### Requirement: Model families SHALL be discovered, not enumerated

The extension SHALL NOT contribute a fixed enumeration of model families.
`codecrosscheck.workerModel` and `codecrosscheck.reviewerModel` SHALL be
free-text settings.

The extension SHALL contribute a command that lists the families actually
available via `vscode.lm.selectChatModels` and writes the user's choice to the
corresponding setting.

When a configured family matches no available model, the failure message SHALL
name the families that *are* available.

#### Scenario: Picker offers only available families

- **WHEN** the model picker command runs
- **THEN** the offered choices are derived from `vscode.lm.selectChatModels`
  and not from a hardcoded list

#### Scenario: Unknown family reports the available set

- **WHEN** a configured family matches no available model
- **THEN** the error names the configured family and lists the available ones

### Requirement: Handlers SHALL use the modern chat response surface

Chat request handlers SHALL return a `ChatResult`. When a run fails, the result
SHALL carry `errorDetails` rather than only prose in the stream.

Handlers SHALL register a followup provider offering the next actions a run
implies — at minimum applying a fix proposal, re-running with `force-fix-all`,
and raising the iteration cap after a non-converged run.

Where the response recommends running another command, it SHALL expose that
command as a button in addition to naming it.

#### Scenario: Fix proposal offers an apply followup

- **WHEN** `/review-branch` finishes with a fix proposal available
- **THEN** the response offers a followup and a button that invoke
  `/apply-review`

#### Scenario: Non-converged run offers a retry followup

- **WHEN** a run ends because the iteration cap was reached
- **THEN** the response offers a followup that re-runs with a higher cap

#### Scenario: Failures surface as result error details

- **WHEN** a handler aborts because the diff is empty, too large, or the model
  call failed
- **THEN** the returned `ChatResult` carries `errorDetails` describing the
  cause

### Requirement: Files attached to the request SHALL be used

Handlers SHALL read `ChatRequest.references` and incorporate the referenced
file or selection contents into the prompt they assemble. Attached context
SHALL NOT be silently discarded.

The response SHALL state which attachments were used, and SHALL count their
size against the same character budget that guards the diff.

#### Scenario: Attached file is included in the prompt

- **WHEN** the user attaches a file to a `/code` or `/review-branch` request
- **THEN** its contents appear in the prompt sent to the model and the response
  names the attachment

#### Scenario: Attachments count against the budget

- **WHEN** the diff plus attachments exceed the configured character cap
- **THEN** the handler aborts with the same guidance it gives for an oversized
  diff

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

