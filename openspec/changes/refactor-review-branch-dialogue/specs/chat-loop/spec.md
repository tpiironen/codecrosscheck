# Capability: chat-loop (delta)

## MODIFIED Requirements

### Requirement: Default model pair

The default worker model SHALL be `openai/gpt-5.4` and the default
reviewer model SHALL be `openai/gpt-5.4`. These defaults apply to the
CLI flags `--worker-model` / `--reviewer-model` and to the VS Code
settings `codecrosscheck.workerModel` / `codecrosscheck.reviewerModel`.
The cross-vendor invariant is preserved at runtime by the chat
participant: when `useChatPickerWorker=true` (default), the worker
follows the Copilot Chat picker, and the participant warns when the
worker and reviewer model ids resolve to the same value.

#### Scenario: CLI uses bumped defaults

- **WHEN** `codecrosscheck "..."` is invoked without `--worker-model`
  or `--reviewer-model`
- **THEN** the worker resolves to `openai/gpt-5.4` and the reviewer
  to `openai/gpt-5.4`

## ADDED Requirements

### Requirement: ChatClient SHALL expose a plain-text send path

`ChatClient` implementations SHALL provide a
`sendText(messages: ChatMessage[]): Promise<string>` method that
returns the raw response text without JSON parsing, without schema
validation, and without the structured-output retry logic used by
`sendStructured`. This path SHALL be used for worker calls whose
output is rich Markdown (e.g. fix proposals containing fenced code
blocks) where forcing the response through a JSON envelope is brittle
on large inputs.

#### Scenario: Worker producing Markdown

- **GIVEN** a worker built with `buildWorkerWithPrompt` and a system
  prompt that requires Markdown output
- **WHEN** the worker is invoked on a 300+ KB diff
- **THEN** the response is returned as raw text with no JSON parsing
  step
- **AND** no `WorkerOutput` schema retry occurs

### Requirement: Reviewers SHALL continue using sendStructured

Reviewer calls SHALL continue to use `sendStructured` with the
`Verdict` schema. The cross-check value of CodeCrossCheck depends on
schema-validated reviewer output (verdict enum + structured issue
list); `sendText` SHALL NOT be used for reviewer calls.

#### Scenario: Reviewer call path

- **WHEN** a reviewer is invoked
- **THEN** the call goes through `client.sendStructured(...)` with
  the `Verdict` schema
- **AND** parse failures retry once with a schema-restating system
  message

### Requirement: Worker prompt loading by name

The agents module SHALL expose `loadPromptByName(name)` and
`buildWorkerWithPrompt(system, client)` so that callers outside the
Stage pipeline (e.g. the `/review-branch` handler) can build workers
with arbitrary system prompts. `buildWorkerWithPrompt` SHALL use the
plain-text `sendText` path.

#### Scenario: /review-branch builds a fixer worker

- **GIVEN** the `/review-branch` handler needs a worker driven by
  `src/prompts/review_branch_fixer.md`
- **WHEN** the handler calls
  `buildWorkerWithPrompt(loadPromptByName("review_branch_fixer"), client)`
- **THEN** the resulting worker uses `client.sendText` and exposes the
  same `Worker` interface as `buildWorker(stage, client)`
