# openspec-integration spec delta

## MODIFIED Requirements

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

## ADDED Requirements

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
