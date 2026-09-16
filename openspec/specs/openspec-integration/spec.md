# openspec-integration Specification

## Purpose
TBD - created by archiving change add-codecrosscheck. Update Purpose after archive.
## Requirements
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

The `@codecrosscheck` chat participant SHALL register slash commands `openspec-init`, `openspec-new`, `openspec-review`, AND `openspec-archive`, mapping respectively to scaffolding, change creation, validator-gated draft of an implementation against the change frame, AND archival. The slash command `openspec-implement` SHALL remain registered as a deprecated alias for `openspec-review` that emits a one-line deprecation notice before delegating.

#### Scenario: Review command drafts implementation against the change frame

- **WHEN** the user sends `@codecrosscheck /openspec-review add-core-engine`
- **THEN** the participant loads `openspec/changes/add-core-engine/`
- **AND** the first streamed message contains the change's `proposal.md` summary
- **AND** the participant runs the PLAN and CODE stages with `--openspec` semantics (validator pre-gate, change frame injected)
- **AND** the EXECUTE stage is skipped by default
- **AND** every iteration's worker artifact and reviewer verdict are streamed to chat

#### Scenario: Implement alias prints deprecation notice

- **WHEN** the user sends `@codecrosscheck /openspec-implement add-core-engine`
- **THEN** the first streamed line warns that the command is deprecated and recommends `/openspec-review`
- **AND** the run continues with identical behaviour to `/openspec-review add-core-engine`

### Requirement: Transcript records OpenSpec source

The JSONL transcript SHALL record, for every reviewer event in OpenSpec mode, the `changeId` that was loaded AND whether the verdict came from the real reviewer (`source: "model"`) OR the validator pre-gate (`source: "validator"`).

#### Scenario: Source field present

- **WHEN** a run completes with `--openspec`
- **THEN** every transcript entry of type `verdict` has a `source` field
- **AND** the value is one of `model` OR `validator`

### Requirement: Review transcript consumable by /apply-review

A run of `/openspec-review <id>` SHALL write a transcript file under
`<workspace>/.codecrosscheck/runs/<iso>.jsonl` whose entries follow the same
schema that `/review-branch` writes, so that `/apply-review` can consume it
without modification.

Specifically, the transcript SHALL contain:

- One `{event: "review-branch-iter", role: "worker", iteration: N, workerId, artifact}` event per worker artifact produced by the CODE stage.
- One `{event: "review-branch-iter", role: "reviewer", iteration: N, reviewerId, verdict}` event per reviewer call (including validator pre-gate calls, marked with `source: "validator"`).
- A terminating `{event: "review-branch-done", approved, iterations, elapsedMs}` event.

#### Scenario: Transcript is discoverable by /apply-review

- **GIVEN** a completed `/openspec-review add-core-engine` run that produced at least one CODE-stage worker artifact
- **WHEN** the user subsequently sends `@codecrosscheck /apply-review`
- **THEN** `findLatestTranscript` returns the openspec-review transcript file
- **AND** `extractFixProposal` returns the most recent CODE-stage worker artifact

#### Scenario: Errors loading the change surface in chat

- **GIVEN** the user passes a change id whose folder does not exist or is missing `proposal.md`
- **WHEN** `/openspec-review <id>` runs
- **THEN** the handler streams an error message naming the missing path
- **AND** the handler returns cleanly without throwing past the chat boundary

### Requirement: changeId input validation before spawn

`validateStrict(changeId)` SHALL reject any `changeId` that does not match
the regex `^[A-Za-z0-9._-]+$` before invoking `child_process.spawn`. This
guard exists because the spawn call uses `shell: true` (required on Windows
to launch `openspec.cmd` shims after Node 22's CVE-2024-27980 hardening),
which would otherwise allow shell-injection from unvalidated chat input.

#### Scenario: Valid changeId passes through

- **WHEN** `validateStrict("add-sha256-cli")` is called
- **THEN** the regex passes and `openspec validate --strict add-sha256-cli`
  is spawned

#### Scenario: Injection attempt is rejected

- **WHEN** `validateStrict("foo; rm -rf /")` is called
- **THEN** the function throws a descriptive error before any process is
  spawned
- **AND** the error message names the offending input

### Requirement: selftest:openspec live harness

The repository SHALL provide an `npm run selftest:openspec` script that
runs an end-to-end PLAN against the `add-sha256-cli` fixture under
`openspec/changes/`. The script SHALL exit non-zero if the validator
pre-gate, OpenSpec frame injection, or reviewer wiring fails. The script
SHALL be opt-in, requiring a configured OpenAI-compatible base URL, and SHALL
skip with a clear message rather than failing when none is configured.

The script SHALL NOT require any provider-specific credential. It SHALL NOT
perform transport teardown for `undici`, which the project no longer uses; the
platform `fetch` needs no such cleanup.

#### Scenario: Selftest runs against a configured endpoint

- **GIVEN** an OpenAI-compatible base URL is configured
- **WHEN** `npm run selftest:openspec` is run
- **THEN** the script reports a structured verdict from the reviewer
- **AND** exits with status 0
- **AND** the process terminates promptly on Windows

#### Scenario: Selftest skips without an endpoint

- **GIVEN** no base URL is configured
- **WHEN** `npm run selftest:openspec` is run
- **THEN** the script reports that it was skipped and why
- **AND** does not report a failure

