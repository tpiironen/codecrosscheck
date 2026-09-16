# vscode-extension spec delta

## ADDED Requirements

### Requirement: Applied edits SHALL be reported as unsaved until they are saved

`/apply-review` SHALL NOT describe an edit held in an unsaved editor buffer with
the same word it uses for a file written to disk. When edits are committed
through the workspace edit host, the report SHALL state that the files are
modified in the editor and are not on disk until saved, and SHALL offer the
user a way to save them.

When no workspace edit host is available and edits are written through the
filesystem — the CLI, and tests — the report SHALL say they were written.

The `-apply.json` debug log SHALL record the same distinction, so a
post-mortem cannot confirm the wrong story.

This is a reporting requirement only. Edits continue to be applied through
`vscode.workspace.applyEdit` so that a single undo reverts the whole batch.

#### Scenario: Host-backed apply reports unsaved buffers

- **GIVEN** `/apply-review` applies edits through the workspace edit host
- **WHEN** the report is rendered
- **THEN** it states the files are modified in the editor and not yet on disk
- **AND** it offers a way to save them

#### Scenario: Filesystem-backed apply reports a write

- **GIVEN** edits are applied with no workspace edit host
- **WHEN** the report is rendered
- **THEN** it states the files were written

#### Scenario: Debug log records the distinction

- **WHEN** a host-backed run writes its `-apply.json`
- **THEN** the recorded status distinguishes an unsaved buffer from a written
  file

#### Scenario: Undo behaviour is unchanged

- **WHEN** a batch of edits is applied through the host
- **THEN** a single undo still reverts the whole batch
