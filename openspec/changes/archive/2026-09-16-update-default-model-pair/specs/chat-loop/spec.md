# chat-loop delta: update-default-model-pair

## MODIFIED Requirements

### Requirement: Worker / reviewer separation

The system SHALL drive each pipeline stage with two distinct `ChatClient` instances: one acting as the **worker** that produces the artifact, and one acting as the **reviewer** that judges it.

#### Scenario: Different defaults from different vendors

- **WHEN** the system runs with no model overrides
- **THEN** the worker uses `anthropic/claude-opus-5` AND the reviewer uses `openai/gpt-5.3-codex`

#### Scenario: Override via CLI flag

- **WHEN** the user passes `--worker-model openai/gpt-4.1 --reviewer-model openai/gpt-5`
- **THEN** the worker uses `openai/gpt-4.1` AND the reviewer uses `openai/gpt-5`

### Requirement: Default model pair

The default worker model SHALL be `anthropic/claude-opus-5` and the default
reviewer model SHALL be `openai/gpt-5.3-codex`. These defaults apply to the CLI
flags `--worker-model` / `--reviewer-model` and to the VS Code settings
`codecrosscheck.workerModel` / `codecrosscheck.reviewerModel`.

The reviewer default SHALL NOT be the same family as the worker default, on any
surface that declares one. Declaring both CLI flags with the same default is a
violation of this requirement even when the values are individually valid.

The cross-vendor invariant is additionally preserved at runtime by the chat
participant: when `useChatPickerWorker=true` (default), the worker follows the
Copilot Chat picker, and the participant warns when the worker and reviewer
model ids resolve to the same value.

#### Scenario: CLI uses the declared defaults

- **WHEN** `codecrosscheck "..."` is invoked without `--worker-model`
  or `--reviewer-model`
- **THEN** the worker resolves to `anthropic/claude-opus-5` and the reviewer
  to `openai/gpt-5.3-codex`

#### Scenario: Reviewer default differs from worker default

- **WHEN** the declared defaults are inspected on any surface
- **THEN** the reviewer default is not the worker's default family

#### Scenario: Chat participant reviewer ignores the picker

- **GIVEN** `codecrosscheck.useChatPickerWorker` is `true`
- **WHEN** the user selects a model in the Copilot Chat picker
- **THEN** that model is used as the worker
- **AND** the reviewer still resolves from `codecrosscheck.reviewerModel`
