# chat-loop Specification

## Purpose
TBD - created by archiving change add-codecrosscheck. Update Purpose after archive.
## Requirements
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

### Requirement: --diff flag attaches branch diff to prompt

The CLI SHALL accept `--diff` (boolean) and `--diff-base <ref>` (string) flags.
When `--diff` is set, the CLI SHALL compute the current branch diff against
the merge-base with `origin/main` (or `--diff-base` when provided, falling
back to `HEAD`) and append it to the task prompt. When the diff is empty, the
CLI SHALL warn on stderr and proceed without diff context. When the diff
computation fails, the CLI SHALL exit non-zero with the underlying error.

#### Scenario: Diff appended to prompt

- **GIVEN** a working branch with committed changes ahead of `origin/main`
- **WHEN** `codecrosscheck "review my work" --diff` is invoked
- **THEN** the worker receives a prompt that includes the unified diff of
  the branch
- **AND** the JSONL transcript records the resolved base ref

#### Scenario: Empty diff is non-fatal

- **GIVEN** a branch identical to `origin/main`
- **WHEN** `codecrosscheck "..." --diff` is invoked
- **THEN** the CLI writes a warning to stderr and runs without diff context
- **AND** exits with the same status it would have without `--diff`

### Requirement: Default model pair

The default worker model SHALL be `openai/gpt-5.4` and the default reviewer
model SHALL be `anthropic/claude-opus-4.6`. These defaults apply to the CLI
flags `--worker-model` / `--reviewer-model` and to the VS Code settings
`codecrosscheck.workerModel` / `codecrosscheck.reviewerModel`.

The reviewer default SHALL NOT be the same family as the worker default.

The cross-vendor invariant is additionally preserved at runtime by the chat
participant: when `useChatPickerWorker=true` (default), the worker follows the
Copilot Chat picker, and the participant warns when the worker and reviewer
model ids resolve to the same value.

#### Scenario: CLI uses bumped defaults

- **WHEN** `codecrosscheck "..."` is invoked without `--worker-model`
  or `--reviewer-model`
- **THEN** the worker resolves to `openai/gpt-5.4` and the reviewer
  to `anthropic/claude-opus-4.6`

#### Scenario: Reviewer default differs from worker default

- **WHEN** the declared defaults are inspected on any surface
- **THEN** the reviewer default is not the worker's default family

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

### Requirement: Structured-response clients SHALL short-circuit on oversized-prompt failures

Structured-response clients SHALL detect token-limit / context-window-exceeded
errors from the underlying transport and SHALL throw a typed
`OversizedPromptError` carrying the model id and the original cause, *before*
attempting the schema-reminder retry. This applies to both
`VscodeLmClient.sendStructured` and `GithubModelsClient.sendStructured`.

Re-sending the identical oversized prompt with a schema-reminder system
message cannot succeed — it produces a second confusing failure (an empty
body, a `{"verdict":"unknown"}` payload, or a model complaint that no schema
is in scope) that masks the real cause. Short-circuiting preserves a single,
actionable error message.

The detector SHALL recognise at minimum the following phrasings (case
insensitive):

- "Message exceeds token limit"
- "maximum context length"
- "context window exceeded" / "context length exceeded"
- "prompt is too long" / "input is too long"
- "request too large"

The detector SHALL NOT classify generic transport failures
(`ECONNRESET`, `Unexpected token …`) as oversized.

#### Scenario: First-attempt token-limit failure skips the retry

- **WHEN** `VscodeLmClient.sendStructured` calls the LM and the call rejects
  with an error whose message matches an oversized-prompt phrasing
- **THEN** the client throws `OversizedPromptError` and SHALL NOT call the
  LM a second time with the schema-reminder retry

#### Scenario: Retry-attempt token-limit failure surfaces as OversizedPromptError

- **WHEN** the first attempt fails with a schema/parse error and the retry
  attempt fails with a token-limit error
- **THEN** the client throws `OversizedPromptError` instead of the
  two-strike "failed schema twice" fallback message

#### Scenario: Unrelated failures are not misclassified

- **WHEN** the LM rejects with `ECONNRESET` or returns prose that fails
  `JSON.parse`
- **THEN** `OversizedPromptError` is NOT thrown and the normal
  retry/two-strike paths run

#### Scenario: OversizedPromptError carries actionable remediation

- **WHEN** `OversizedPromptError` is thrown
- **THEN** its `.message` includes the model id and suggests at least one
  concrete remedy (`diff-base=<closer-ref>`, split the branch, or pick a
  larger reviewer model)

### Requirement: Structured-response clients SHALL detect model refusals before JSON parsing

Structured-response clients SHALL inspect each raw model response (initial
attempt and retry) for a content-policy refusal pattern before attempting
JSON parsing. This applies to both `VscodeLmClient.sendStructured` and
`GithubModelsClient.sendStructured`. When a refusal is detected, the client
SHALL throw a `ModelRefusalError` carrying the model id and a truncated
snippet of the response. A refusal on the initial attempt SHALL NOT
trigger the schema-reminder retry — the second attempt is guaranteed to
fail the same way and only burns tokens.

The refusal detector SHALL be conservative: it SHALL only fire when the
refusal phrasing appears at the start of the response (optionally after a
fence opener), so that legitimate JSON payloads containing the word
"sorry" inside string values are NOT misclassified.

#### Scenario: Plain-prose refusal short-circuits the retry

- **GIVEN** a worker model that responds with
  `Sorry, I can't assist with that.`
- **WHEN** `sendStructured` is called with any schema
- **THEN** the call SHALL throw a `ModelRefusalError`
- **AND** no schema-reminder retry SHALL be issued
- **AND** the error message SHALL include the model id and a snippet of the
  refusal text

#### Scenario: Fenced refusal is detected even when wrapped in an unknown language tag

- **GIVEN** a model response of ` ```text\nSorry, I can't help with that.\n``` `
- **WHEN** `sendStructured` is called
- **THEN** the call SHALL throw a `ModelRefusalError`
- **AND** the error message SHALL NOT be a `JSON.parse` "Unexpected token"
  error

#### Scenario: Valid JSON containing the word "sorry" is NOT flagged as a refusal

- **GIVEN** a model response of `{"artifact": "sorry that was confusing"}`
- **WHEN** `sendStructured` is called with a schema accepting that shape
- **THEN** the call SHALL return the parsed object
- **AND** SHALL NOT throw `ModelRefusalError`

### Requirement: Fence extraction SHALL only unwrap json-labelled or unlabelled fences

The `extractJson` helper in `VscodeLmClient` SHALL only unwrap a fenced block
whose opening fence is either unlabelled or labelled `json`, and SHALL require
a newline immediately after the fence opener. Unknown language tags such as
`text`, `yaml`, or `markdown` SHALL NOT be unwrapped; the helper SHALL fall
through to the brace-pair fallback or raw-trim path for those cases.

#### Scenario: Unknown-fence prose falls through, not silently unwrapped

- **GIVEN** a model response consisting of a fenced block tagged `text`
  containing the prose "Here is some prose."
- **WHEN** `extractJson` is invoked on that string
- **THEN** the returned value SHALL NOT be the unwrapped prose
- **AND** the subsequent `JSON.parse` SHALL fail on the full response,
  producing a clear two-strike error that includes a snippet of the raw
  response

### Requirement: Two-strike structured-response failures SHALL include raw snippets

Two-strike structured-response failures SHALL produce an error message that
includes a single-line, whitespace-collapsed snippet (≤160 characters) of
each attempt's raw response, in addition to the parse/validation error
messages. This applies when both `sendStructured` attempts fail without
producing a refusal. The snippets let users diagnose schema drift or
unexpected formats from chat output alone, without opening the transcript.

#### Scenario: Two-strike failure includes both raw snippets

- **GIVEN** a model that returns non-JSON, non-refusal prose on both
  attempts
- **WHEN** `sendStructured` is called
- **THEN** the thrown `Error.message` SHALL contain the substring
  `failed schema "<name>" twice`
- **AND** SHALL contain a `(raw: ...)` snippet for each attempt

