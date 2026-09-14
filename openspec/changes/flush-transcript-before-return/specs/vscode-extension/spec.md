# vscode-extension delta: flush-transcript-before-return

## ADDED Requirements

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
