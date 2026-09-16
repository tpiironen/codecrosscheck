# vscode-extension spec delta

## ADDED Requirements

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
