# Capability: vscode-extension

## ADDED Requirements

### Requirement: Chat participant registration

The extension SHALL register a chat participant with id `codecrosscheck` that drives the review loop using two distinct Copilot models selected via `vscode.lm`.

#### Scenario: Participant appears in Copilot Chat

- **WHEN** the extension activates in a workspace with Copilot Chat available
- **THEN** typing `@codecrosscheck` in the chat input shows the participant in the suggestion list

#### Scenario: Two distinct models in trace

- **WHEN** the participant runs a stage that requires at least one revision
- **THEN** the streamed chat output shows the worker model name AND the reviewer model name
- **AND** the two names differ when defaults are used

### Requirement: Slash commands

The participant SHALL accept slash commands `/plan`, `/code`, and `/execute` that restrict the pipeline to a single stage. An invocation with no slash command SHALL run all three stages in order.

#### Scenario: /plan restricts to PLAN stage only

- **WHEN** the user sends `@codecrosscheck /plan add caching to /products`
- **THEN** only the PLAN stage runs
- **AND** no CODE or EXECUTE output appears in the chat

### Requirement: Streaming output

The participant SHALL stream loop events to the chat as they occur, including the worker artifact, the reviewer's JSON verdict, and revision rounds. The final message SHALL include `approved`, `iterations`, and a clickable link to the JSONL transcript.

#### Scenario: Per-iteration visibility

- **GIVEN** a run that takes two iterations to converge
- **WHEN** the run completes
- **THEN** the chat shows iteration-1 worker output, iteration-1 reviewer verdict, iteration-2 worker output, iteration-2 reviewer verdict, AND the final summary in that order

### Requirement: Editor commands

The extension SHALL register two Command Palette commands — `CodeCrossCheck: Review Selection` and `CodeCrossCheck: Review Active File` — that invoke ONLY the code reviewer (no worker, no loop) on the supplied text and present the issues in a webview.

#### Scenario: Review Selection on flagged code

- **GIVEN** an active editor with a selected SQL-injection-prone line
- **WHEN** the user runs `CodeCrossCheck: Review Selection`
- **THEN** the reviewer is invoked with only the selection
- **AND** the resulting issues are displayed in a webview within the editor
- **AND** the worker is not invoked

### Requirement: VS Code settings

The extension SHALL contribute the following settings under the `codecrosscheck.*` namespace, each with a default value AND a user-visible description:

- `codecrosscheck.workerModel`
- `codecrosscheck.reviewerModel`
- `codecrosscheck.maxIters`
- `codecrosscheck.execute.timeoutMs`
- `codecrosscheck.execute.allowNetwork`

#### Scenario: Setting overrides default model

- **GIVEN** `codecrosscheck.workerModel` is set to `openai/gpt-4.1` in workspace settings
- **WHEN** the participant builds the worker client
- **THEN** the worker uses the `openai/gpt-4.1` model family

### Requirement: In-extension sandbox

The `/execute` flow SHALL invoke `runSandboxed` from `src/sandbox.ts` directly within the extension host process. The extension SHALL NOT shell out to a Python or other external runner for execution.

#### Scenario: Sandboxed execution from chat

- **WHEN** the user sends `@codecrosscheck /execute <task>` with a generated code artifact
- **THEN** the sandbox runs in the extension host
- **AND** stdout, stderr, and exitCode are captured and shown in chat

### Requirement: Quota and missing-model handling

When `vscode.lm.selectChatModels` returns no matching model (quota exhausted or family unavailable), the participant SHALL emit a chat error that names the requested family AND suggests a fallback, AND SHALL NOT silently fail.

#### Scenario: Unavailable family produces actionable error

- **GIVEN** `codecrosscheck.workerModel` is set to a family not currently available
- **WHEN** the participant tries to build the worker client
- **THEN** the chat shows an error mentioning the family name AND a suggestion to update the setting
