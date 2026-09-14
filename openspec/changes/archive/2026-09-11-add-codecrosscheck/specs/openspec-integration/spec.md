# Capability: openspec-integration

## ADDED Requirements

### Requirement: Opt-in activation

OpenSpec integration SHALL be activated only when the user explicitly opts in: via the `--openspec <change-id>` CLI flag OR an `/openspec-*` chat slash command. When not opted in, the CLI AND the participant SHALL exhibit identical behavior to the non-OpenSpec build.

#### Scenario: Default run does not load OpenSpec

- **WHEN** the user runs `codecrosscheck "task"` with no `--openspec` flag
- **THEN** no `openspec/` files are read
- **AND** no `openspec validate` invocation occurs

#### Scenario: Opt-in run loads change

- **WHEN** the user runs `codecrosscheck "task" --openspec add-core-engine`
- **THEN** files under `openspec/changes/add-core-engine/` are loaded
- **AND** their content is injected into every reviewer prompt

### Requirement: Deterministic pre-gate

Before EVERY reviewer call in an OpenSpec-enabled run, the system SHALL invoke `openspec validate <change-id> --strict`. On non-zero validator exit, the loop SHALL synthesize a reviewer verdict with `verdict: "revise"` AND a single issue describing the validation failure, WITHOUT calling the real reviewer model.

#### Scenario: Validation failure consumes zero reviewer tokens

- **GIVEN** a change with a malformed spec delta header
- **WHEN** the loop runs with `--openspec`
- **THEN** the synthesized verdict is emitted
- **AND** no request is made to the reviewer `ChatClient` for that iteration
- **AND** the JSONL transcript marks the verdict as `source: "validator"`

#### Scenario: Missing CLI is non-fatal

- **GIVEN** the `openspec` CLI is not on PATH
- **WHEN** the loop runs with `--openspec`
- **THEN** the synthesized verdict states the CLI is missing AND suggests installation
- **AND** the loop does not crash

### Requirement: Diff-only reviewer context

The reviewer prompt in OpenSpec mode SHALL receive the patch produced by `git diff <mergeBase>...HEAD` instead of the full workspace contents. The patch SHALL be restricted to files within the change's stated impact AND chunked to fit the configured token budget.

#### Scenario: Out-of-scope files filtered

- **GIVEN** a change whose impact lists `src/loop.ts`
- **WHEN** the diff slicer runs against a worktree that also modifies `src/unrelated.ts`
- **THEN** only the `src/loop.ts` hunks are included in the reviewer prompt

#### Scenario: Large diffs chunked

- **GIVEN** a diff whose estimated token size exceeds the configured budget
- **WHEN** the chunker runs
- **THEN** the patch is split per file
- **AND** each chunk is below the budget
- **AND** consecutive chunks share at least 2 lines of overlap context

### Requirement: Chat slash commands

The `@codecrosscheck` chat participant SHALL register slash commands `openspec-init`, `openspec-new`, `openspec-review`, AND `openspec-archive`, mapping respectively to scaffolding, change creation, spec-framed review execution, AND archival. `openspec-implement` SHALL remain registered as a deprecated alias for `openspec-review`.

#### Scenario: Review command runs the spec-framed pipeline

- **WHEN** the user sends `@codecrosscheck /openspec-review add-core-engine`
- **THEN** the participant runs PLAN→CODE with `--openspec` semantics
- **AND** the streamed output includes the change's `proposal.md` summary in the first message
- **AND** EXECUTE is NOT run, because the sandbox cannot reproduce a real workspace and its verdict would mislead

#### Scenario: Deprecated alias forwards

- **WHEN** the user sends `@codecrosscheck /openspec-implement add-core-engine`
- **THEN** the participant prints a deprecation notice naming `/openspec-review`
- **AND** runs the same handler

#### Scenario: Transcript is readable by /apply-review

- **WHEN** an `/openspec-review` run produces a CODE-stage artifact
- **THEN** the transcript contains `review-branch-iter` events with `role: "worker"` and a terminating `review-branch-done` event
- **AND** `/apply-review` can locate that transcript and extract the artifact without any translation step

### Requirement: Transcript records OpenSpec source

The JSONL transcript SHALL record, for every reviewer event in OpenSpec mode, the `changeId` that was loaded AND whether the verdict came from the real reviewer (`source: "model"`) OR the validator pre-gate (`source: "validator"`).

#### Scenario: Source field present

- **WHEN** a run completes with `--openspec`
- **THEN** every transcript entry of type `verdict` has a `source` field
- **AND** the value is one of `model` OR `validator`
