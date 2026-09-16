# vscode-extension spec delta

## ADDED Requirements

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
