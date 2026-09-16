# vscode-extension spec delta

## ADDED Requirements

### Requirement: review-branch SHALL offer agents a workspace toolset

The triager and the fixer SHALL be granted the read-only workspace toolset
before each fixer iteration of `/review-branch`, rather than a pre-assembled
block of file contents. Neither agent's prompt SHALL carry a
`# Repository file context` section.

Every tool call SHALL be surfaced in the chat progress stream naming the agent
and the tool, and recorded in the run transcript.

When an agent's tool budget or deadline is exhausted, the extension SHALL say
so in the chat output, naming the setting that raises the limit.

#### Scenario: Agent reads a file nobody predicted it would need

- **WHEN** the triager finds that judging a finding turns on a file the finding
  never mentions
- **THEN** it reads that file through the toolset and judges the finding,
  rather than returning `uncertain` for want of context

#### Scenario: Agent obtains an unlisted file type

- **WHEN** a finding cites a file whose extension was not in the former
  harvesting allowlist
- **THEN** the agent can still read it and produce a concrete fix

#### Scenario: Tool calls are visible and recorded

- **WHEN** an agent makes tool calls during a run
- **THEN** each call appears in the chat progress stream with the agent and
  tool name
- **AND** each call is recorded in the run transcript

#### Scenario: Exhausted budget is reported to the user

- **WHEN** an agent reaches its tool-call budget or deadline
- **THEN** the chat output states which limit was hit, how many calls were
  made, and which setting raises it

### Requirement: review-branch SHALL report unaddressed findings structurally

A finding the worker could neither fix nor rebut SHALL be reported because the
worker set that status in its structured response, not because a regular
expression matched an English phrase in its prose. The chat output SHALL list
each such finding with the worker's own stated reason.

#### Scenario: Worker cannot produce a patch

- **WHEN** the worker returns a fix whose status is `unaddressed`
- **THEN** the summary lists that finding together with the explanation the
  worker gave
- **AND** no prose-matching heuristic is consulted to discover it

#### Scenario: A fixed finding is not reported as unaddressed

- **WHEN** every fix in the proposal has status `fixed` or `disagree`
- **THEN** no unaddressed block is rendered

### Requirement: Edits SHALL repair line endings and nothing else

An edit SHALL be applied only when its `oldString` occurs in the target file
exactly once, after normalising line endings and no other difference. The
replacement SHALL be written with the line endings of the form that matched, so
the patched region agrees with the surrounding file.

Line endings are the one difference the model cannot be held to: it reads the
file through the toolset, which preserves CRLF exactly, but emits LF in its
JSON regardless. Every other mismatch SHALL be a hard failure — the handler
SHALL NOT strip unified-diff markers or try any other repaired variant, because
a near-miss there means the edit is wrong and repairing it would conceal that.

A non-matching edit SHALL be skipped with a reason and the file left unchanged.

#### Scenario: Model emits LF against a CRLF file

- **GIVEN** a target file with CRLF line endings
- **AND** an edit whose `oldString` carries the same text with LF
- **WHEN** the handler applies it
- **THEN** the edit is applied
- **AND** the patched region is written with CRLF, matching the file

#### Scenario: Model emits CRLF against an LF file

- **GIVEN** a target file with LF line endings
- **AND** an edit whose `oldString` carries the same text with CRLF
- **WHEN** the handler applies it
- **THEN** the edit is applied
- **AND** no CR is introduced into the file

#### Scenario: oldString carries unified-diff markers

- **GIVEN** an edit whose `oldString` lines begin with `-`, `+` or a space
- **WHEN** the handler applies it
- **THEN** the edit is skipped with reason `oldString not found`
- **AND** the file is unchanged

#### Scenario: Content differs by more than line endings

- **GIVEN** an edit whose `oldString` differs from the file in any character
  other than a line terminator
- **WHEN** the handler applies it
- **THEN** the edit is skipped and the file is unchanged

#### Scenario: Empty oldString creates a new file

- **GIVEN** an edit with `oldString === ""`
- **AND** the resolved target path does NOT exist
- **WHEN** the handler applies the edit
- **THEN** parent directories are created
- **AND** `newString` is written as the full file content
- **AND** the outcome is `applied`

#### Scenario: Empty oldString refuses to overwrite an existing file

- **GIVEN** an edit with `oldString === ""`
- **AND** the resolved target path already exists
- **WHEN** the handler validates the edit
- **THEN** the edit is skipped with reason
  `file already exists (oldString empty implies create)`
- **AND** the file is unchanged

### Requirement: Tool budget settings

The extension SHALL contribute `codecrosscheck.tools.maxCalls` (integer,
default 24) and `codecrosscheck.tools.deadlineMs` (integer, default 180000),
each with a user-visible description. Setting `maxCalls` to 0 SHALL disable
tool access.

#### Scenario: Default budget

- **GIVEN** a fresh install with no user overrides
- **WHEN** an agent runs with tools
- **THEN** it may make at most 24 calls within 180 seconds

#### Scenario: Tools disabled

- **GIVEN** `codecrosscheck.tools.maxCalls` is 0
- **WHEN** an agent runs
- **THEN** it makes no tool calls and answers from the prompt alone

## MODIFIED Requirements

### Requirement: /apply-review slash command

The participant SHALL accept `/apply-review`. The handler SHALL locate the
most recent review transcript JSONL emitted by `/review-branch`, read the
structured fix proposal recorded in it, and apply each edit that proposal
carries. The handler SHALL NOT call a language model: the edits were produced
by the fixer and are applied as recorded. The handler SHALL NOT modify files
outside the workspace root and SHALL NOT apply an edit whose `oldString` does
not appear exactly once in the target file.

A transcript that predates structured fix proposals carries Markdown only. The
handler SHALL report that plainly and direct the user to re-run
`/review-branch`, rather than applying nothing and reporting success.

#### Scenario: Apply edits recorded in the latest transcript

- **GIVEN** a workspace where `/review-branch` has produced at least
  one transcript ending with a `review-branch-done` event
- **WHEN** the user sends `@codecrosscheck /apply-review`
- **THEN** the handler reads the newest matching transcript
- **AND** extracts the last `review-branch-iter` event with
  `role: "worker"` as the fix proposal
- **AND** applies each edit whose `path` resolves under the workspace root and
  whose `oldString` matches exactly once, via `vscode.workspace.fs`
- **AND** calls no language model
- **AND** streams a per-edit applied/skipped report and a summary
  card recommending `git diff` and a follow-up `/review-branch`

#### Scenario: Legacy Markdown-only transcript

- **GIVEN** the newest transcript records a worker artifact but no structured
  proposal
- **WHEN** the user sends `@codecrosscheck /apply-review`
- **THEN** the handler states that the transcript predates structured fix
  proposals and names `/review-branch` as the remedy
- **AND** shows the stored proposal
- **AND** does NOT write to any file

#### Scenario: No transcript available

- **GIVEN** a workspace whose extension transcripts folder is empty
  or has no transcripts containing `review-branch-done`
- **WHEN** the user sends `@codecrosscheck /apply-review`
- **THEN** the handler streams a clear error message naming
  `/review-branch` as the prerequisite
- **AND** does NOT call any LLM
- **AND** does NOT write to any file

#### Scenario: Path escape attempt is rejected

- **GIVEN** an edit whose `path` resolves outside the
  workspace root (e.g. `../../etc/passwd` or an absolute path)
- **WHEN** the handler validates the edit
- **THEN** the edit is skipped
- **AND** the report records `skipped: path outside workspace`
- **AND** no file is written

#### Scenario: Ambiguous or missing oldString

- **GIVEN** an edit whose `oldString` is missing from
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

### Requirement: apply-review debug log

The handler SHALL persist a debug artifact at
`<workspace>/.codecrosscheck/runs/<iso>-apply.json` containing the
source transcript path, the iteration number, the applied `edits[]`, and the
per-edit `outcomes[]`. The log SHALL be written on every run
(including zero-edit runs), and the path SHALL be linked from the
chat output.

#### Scenario: Proposal contained zero edits

- **GIVEN** a fix proposal in which every finding is `disagree` or
  `unaddressed`
- **WHEN** `/apply-review` runs
- **THEN** a debug log is still written next to the source transcript
- **AND** the log contains `edits: []` and `outcomes: []`

### Requirement: review-branch worker-disagreement adjudication

The `/review-branch` fixer SHALL be able to push back on a reviewer finding by
returning that fix with status `disagree` and its rebuttal in `explanation`.
The extension SHALL render those rebuttals at the end of the chat output as a
numbered, blockquoted decision block, accompanied by an explanation of how the
user adjudicates: accept by running `/apply-review` (a rebutted finding carries
no edits, so nothing is applied for it) or override by re-running
`/review-branch` with `force-fix-all` in the user prompt.

When the user prompt contains the token `force-fix-all` (matched as
a whole word, case-insensitive), the fixer input SHALL include a
`# User override` section, and the fixer prompt SHALL require a
concrete fix for every reviewer finding and forbid the `disagree`
status in that round.

#### Scenario: Worker rebuts one finding

- **GIVEN** the fixer returned status `disagree` for issue 2 of 3
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
- **AND** no fix in the response carries status `disagree`
- **AND** every reviewer finding has a concrete fix

## REMOVED Requirements

### Requirement: review-branch repository file context

**Reason**: Pre-computed harvesting cannot supply a file whose relevance is
only discovered mid-reasoning. Measured on the 2026-09-16 dogfood run, both
candidate heuristics either found nothing or halved the legibility of the two
files that mattered. Agents now read what they need through the workspace
toolset.

**Migration**: None required. `/review-branch` behaves the same from the user's
side; the fixer and triager fetch source themselves.

### Requirement: review-branch blocked-finding detection

**Reason**: The dodge detectors were English-phrase regexes with obvious false
positives (`pending source` occurs in ordinary prose). The fixer now states the
outcome for each finding in a structured `status` field.

**Migration**: None required. Superseded by "review-branch SHALL report
unaddressed findings structurally".

### Requirement: oldString safety-net repairs

**Reason**: The diff-marker and general repair candidates compensated for a
lossy Markdown round trip between `/review-branch` and `/apply-review`. That
round trip is gone — edits travel as structured data — so a near-miss there now
indicates a wrong edit rather than a transport artefact.

**Migration**: None required. Superseded by "Edits SHALL repair line endings and
nothing else", which keeps the line-ending pairing (dogfooding on 2026-09-16
showed the model still emits LF against a CRLF file) and the file-creation
scenarios, but drops diff-marker stripping.
