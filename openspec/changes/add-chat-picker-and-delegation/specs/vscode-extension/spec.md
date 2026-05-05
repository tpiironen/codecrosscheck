# Capability: vscode-extension (delta)

## ADDED Requirements

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
handler SHALL compute the current branch diff against the merge-base with
`origin/main` (or `HEAD` if no remote tracking ref is found), attach it as
context to the prompt, and run the PLAN stage as a code review.

#### Scenario: Branch diff is reviewed

- **GIVEN** a branch with committed changes ahead of `origin/main`
- **WHEN** the user sends `@codecrosscheck /review-branch focus on auth`
- **THEN** the worker receives the unified diff plus the extra instructions
- **AND** the PLAN stage runs to a verdict
- **AND** the chat output streams the verdict with a clickable transcript link

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
