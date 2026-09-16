# vscode-extension spec delta

## ADDED Requirements

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
