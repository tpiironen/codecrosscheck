# Capability: chat-loop

## ADDED Requirements

### Requirement: Worker / reviewer separation

The system SHALL drive each pipeline stage with two distinct `ChatClient` instances: one acting as the **worker** that produces the artifact, and one acting as the **reviewer** that judges it.

#### Scenario: Different defaults from different vendors

- **WHEN** the system runs with no model overrides
- **THEN** the worker uses `openai/gpt-5.4` AND the reviewer uses `anthropic/claude-opus-4.6`

#### Scenario: Override via CLI flag

- **WHEN** the user passes `--worker-model openai/gpt-4.1 --reviewer-model openai/gpt-5`
- **THEN** the worker uses `openai/gpt-4.1` AND the reviewer uses `openai/gpt-5`

### Requirement: Loop termination

The system SHALL stop the loop when the reviewer returns `verdict: "approve"` OR when iteration count reaches `maxIters`.

#### Scenario: Approve on first iteration

- **WHEN** the reviewer returns `{ verdict: "approve" }` on the first iteration
- **THEN** the loop returns `{ approved: true, iterations: 1 }` AND the worker is not invoked again

#### Scenario: Revise then approve

- **GIVEN** `maxIters = 3`
- **WHEN** the reviewer returns `revise` on iteration 1 and `approve` on iteration 2
- **THEN** the loop returns `{ approved: true, iterations: 2 }`
- **AND** the iteration-2 worker prompt contains the iteration-1 artifact
- **AND** the iteration-2 worker prompt contains the structured issues from iteration 1

#### Scenario: Iteration cap reached

- **GIVEN** `maxIters = 2`
- **WHEN** the reviewer returns `revise` on iterations 1 and 2
- **THEN** the loop returns `{ approved: false, iterations: 2 }`
- **AND** the artifact is the last produced artifact
- **AND** the unresolved issues are present in `history`

### Requirement: Structured reviewer verdicts

The reviewer SHALL emit JSON validated by a zod schema with shape `{ verdict: "approve"|"revise", issues: Issue[] }` where each `Issue` has `{ severity: "low"|"medium"|"high", where: string, why: string, suggestion: string }`. Invalid responses SHALL trigger one retry with a schema-restating follow-up message; a second invalid response SHALL fail the iteration.

#### Scenario: Valid verdict accepted

- **WHEN** the reviewer returns syntactically valid JSON matching the schema
- **THEN** the parsed verdict is used and the loop proceeds

#### Scenario: Malformed JSON recovers on retry

- **WHEN** the reviewer returns malformed JSON on the first attempt
- **THEN** the system retries once with the schema repeated
- **AND** if the retry succeeds the loop proceeds normally

#### Scenario: Repeated malformed JSON fails iteration

- **WHEN** the reviewer returns malformed JSON twice in a row
- **THEN** the iteration fails with a descriptive error
- **AND** no further loop iterations occur

### Requirement: Three-stage pipeline

The pipeline SHALL run the stages `PLAN`, `CODE`, `EXECUTE` in order. The `CODE` stage SHALL receive the approved `PLAN` artifact as context. The `EXECUTE` stage SHALL run the produced code via the sandbox and SHALL feed `{ stdout, stderr, exitCode, durationMs }` to its reviewer as the artifact under judgment.

#### Scenario: Stages run in order

- **WHEN** `runPipeline` is invoked with `stages: ["plan", "code", "execute"]`
- **THEN** PLAN completes before CODE starts AND CODE completes before EXECUTE starts

#### Scenario: Stage subset

- **WHEN** `runPipeline` is invoked with `stages: ["plan"]`
- **THEN** only the PLAN stage runs AND the result contains only PLAN history

### Requirement: Sandboxed execution

Code executed in the `EXECUTE` stage SHALL run in a temporary working directory under `os.tmpdir()`, with a hard timeout, with the environment scrubbed to an allowlist, and with network access denied unless `allowNetwork: true` is explicitly set.

#### Scenario: Timeout enforced

- **GIVEN** `timeoutMs: 1000`
- **WHEN** the executed code runs an infinite loop
- **THEN** the process is killed within 2000 ms
- **AND** `runSandboxed` returns with a non-zero `exitCode`

#### Scenario: Tempdir isolation

- **WHEN** the executed code writes to its current working directory
- **THEN** the writes occur under `os.tmpdir()`
- **AND** the tempdir is removed after `runSandboxed` returns

#### Scenario: Environment scrubbed

- **GIVEN** the calling process has `SECRET_KEY=hunter2` in its environment
- **WHEN** the executed code prints its environment
- **THEN** the output does not contain `SECRET_KEY` or `hunter2`

### Requirement: Provider-agnostic ChatClient

Worker and reviewer SHALL be invoked through the `ChatClient` interface. The implementation SHALL provide at least two adapters: one for the GitHub Models OpenAI-compatible endpoint and one for the VS Code Language Model API (`vscode.lm`). Adding a new provider SHALL require only a new adapter, not changes to the loop.

#### Scenario: GitHub Models adapter authenticates

- **GIVEN** `GITHUB_TOKEN` is set with `models:read` scope
- **WHEN** the GitHub Models adapter sends a request
- **THEN** the request includes `Authorization: Bearer <token>`
- **AND** the request targets `https://models.github.ai/inference/chat/completions`

#### Scenario: vscode.lm adapter selects the requested model

- **WHEN** the `vscode.lm` adapter is built with family `gpt-5`
- **THEN** it calls `vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-5" })`

### Requirement: JSONL transcript

The CLI SHALL append one JSON object per loop event (worker call, reviewer call, verdict, retry, completion) to `.codecrosscheck/runs/<ISO-timestamp>.jsonl`.

#### Scenario: Transcript completion

- **WHEN** the CLI completes a pipeline run
- **THEN** the transcript file's final line is a JSON object with `event: "completed"` AND `approved: <boolean>`

### Requirement: CLI exit codes

The CLI SHALL exit with status `0` when the final stage's `approved` is `true`, AND with status `1` otherwise.

#### Scenario: Approved run exits zero

- **WHEN** the pipeline final stage returns `approved: true`
- **THEN** the CLI exits with code `0`

#### Scenario: Iteration cap reached exits non-zero

- **WHEN** the pipeline final stage returns `approved: false`
- **THEN** the CLI exits with code `1`
