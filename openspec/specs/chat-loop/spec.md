# chat-loop Specification

## Purpose
TBD - created by archiving change add-codecrosscheck. Update Purpose after archive.
## Requirements
### Requirement: Worker / reviewer separation

The system SHALL drive each pipeline stage with two distinct `ChatClient` instances: one acting as the **worker** that produces the artifact, and one acting as the **reviewer** that judges it.

#### Scenario: Different defaults from different vendors

- **WHEN** the system runs with no model overrides
- **THEN** the worker uses `anthropic/claude-opus-5` AND the reviewer uses `openai/gpt-5.3-codex`

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

Code executed in the `EXECUTE` stage SHALL run in a temporary working directory
under `os.tmpdir()`, with a hard timeout, and with the environment scrubbed to
an allowlist. It SHALL NOT claim any isolation property it does not enforce.

Specifically, the sandbox SHALL NOT set `NO_PROXY` as a network-denial
mechanism. `NO_PROXY` instructs clients to bypass a proxy and does not deny
network access, so presenting it as an `allowNetwork: false` implementation
misrepresents the boundary. The `allowNetwork` option SHALL be removed rather
than retained with no effect, and network access SHALL be documented as
unrestricted.

Documentation and setting descriptions SHALL state plainly that generated code
runs with the invoking user's filesystem privileges.

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

#### Scenario: Sandbox does not set proxy-bypass variables

- **WHEN** code is executed through the sandbox
- **THEN** the child environment contains no `NO_PROXY` or `no_proxy` entry
  introduced by the sandbox

### Requirement: Provider-agnostic ChatClient

Worker and reviewer SHALL be invoked through the `ChatClient` interface. The implementation SHALL provide at least two adapters: one for any OpenAI-compatible `/chat/completions` endpoint and one for the VS Code Language Model API (`vscode.lm`). Adding a new provider SHALL require only a new adapter, not changes to the loop.

The OpenAI-compatible adapter SHALL take its base URL from configuration and
SHALL NOT default to any provider. A missing base URL SHALL fail with an error
naming the configuration that supplies it. Defaulting to a provider is how the
adapter came to be hard-wired to a service that was subsequently retired.

The adapter SHALL treat the API key as optional. When no key is configured it
SHALL omit the `Authorization` header rather than sending an empty or
placeholder credential, so that endpoints requiring no authentication work
unmodified.

The adapter SHALL NOT source credentials from a provider-specific helper such
as `gh auth token`. A credential resolved for one provider must not be sent to
an arbitrary configured base URL.

#### Scenario: Adapter sends a configured key

- **GIVEN** a base URL and an API key are configured
- **WHEN** the OpenAI-compatible adapter sends a request
- **THEN** the request includes `Authorization: Bearer <key>`
- **AND** the request targets `<base URL>/chat/completions`

#### Scenario: Adapter omits auth when no key is configured

- **GIVEN** a base URL is configured and no API key is
- **WHEN** the adapter sends a request
- **THEN** the request carries no `Authorization` header

#### Scenario: Missing base URL is a named error

- **GIVEN** no base URL is configured
- **WHEN** the adapter is constructed
- **THEN** it throws an error naming the configuration that supplies the base
  URL

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

### Requirement: ChatClient SHALL expose a plain-text send path

`ChatClient` implementations SHALL provide a
`sendText(messages: ChatMessage[]): Promise<string>` method that
returns the raw response text without JSON parsing, without schema
validation, and without the structured-output retry logic used by
`sendStructured`. This path SHALL be used for worker calls whose
output is rich Markdown (e.g. stage artifacts containing fenced code
blocks) where forcing the response through a JSON envelope is brittle
on large inputs.

#### Scenario: Worker producing Markdown

- **GIVEN** a worker built with `buildWorker` and a stage prompt that requires
  Markdown output
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

The agents module SHALL expose `loadPromptByName(name)` so that agents outside
the Stage pipeline can be built from a named prompt file.

`buildWorkerWithPrompt(system, client)` is removed: the only caller was the
`/review-branch` fixer, which now returns a schema-validated fix proposal
rather than Markdown, and so is built with `buildFixer(client)`.

#### Scenario: /review-branch builds a fixer

- **GIVEN** the `/review-branch` handler needs a fixer driven by
  `src/prompts/review_branch_fixer.md`
- **WHEN** the handler calls `buildFixer(client)`
- **THEN** the resulting fixer loads that prompt by name and returns a
  schema-validated fix proposal

#### Scenario: Triager is built the same way

- **WHEN** the handler calls `buildTriager(client)`
- **THEN** the triager loads `finding_triage.md` via `loadPromptByName`

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

### Requirement: Structured finding triage

The system SHALL provide a triage agent that judges whether each reviewer
finding is real, separately from any step that drafts fixes. The triage agent
SHALL return a zod-validated structured result, not prose to be parsed.

Each triage entry SHALL carry the finding's `id`, a `status` of `confirmed`,
`rejected` or `uncertain`, and an `evidence` string.

Evidence SHALL be required for every status, including rejections. A rejection
SHALL cite the code, type declaration, test or documentation that settles the
question. Asserting that a finding merely looks wrong is not evidence.

The `uncertain` status SHALL exist so that the agent is never forced into a
binary choice it cannot support. An agent compelled to guess produces a guess
that later becomes a code edit.

#### Scenario: A finding contradicted by the type declarations

- **GIVEN** a finding claiming an API does not accept a documented option
- **WHEN** triage runs with that API's declaration available as evidence
- **THEN** the entry's status is `rejected`
- **AND** its evidence quotes the declaration

#### Scenario: Triage cannot answer from the evidence available

- **GIVEN** a finding whose correctness depends on a file not provided
- **WHEN** triage runs
- **THEN** the entry's status is `uncertain` rather than `confirmed` or
  `rejected`

#### Scenario: Triage output is schema-validated

- **WHEN** the triage agent returns a result missing a `status`
- **THEN** the structured-response path rejects it rather than accepting a
  partially parsed result

### Requirement: Subprocess invocation SHALL NOT shell-interpret a command string

Per the repository's implementation conventions, subprocess invocations SHALL
use `spawn` with an explicit argument vector, `cwd`, and a hard timeout.

The post-apply build gate accepts a user-authored command line, which
necessarily requires a shell to interpret. Where a shell is unavoidable the
implementation SHALL document why at the call site, SHALL source the command
only from a non-workspace-overridable setting, and SHALL enforce the same
timeout and output cap as any other subprocess.

#### Scenario: Build gate enforces a timeout and output cap

- **WHEN** a configured build command runs longer than the configured timeout
- **THEN** the child is terminated, the result reports `timedOut: true`, and
  the captured output is truncated to the configured cap

#### Scenario: Shell usage is justified at the call site

- **WHEN** the build gate implementation is inspected
- **THEN** it carries a comment explaining why a shell is required and
  recording that the command source is not workspace-overridable

### Requirement: JSON Schema SHALL be generated by the validation library

The structured-output path SHALL derive its JSON Schema from the same zod
schema it validates against, using zod's own conversion rather than a separate
package.

The generated schema SHALL satisfy the constraints of the provider's strict
structured-output mode — every property required and additional properties
disallowed — or the request SHALL NOT declare strict mode.

#### Scenario: Verdict schema round-trips through the provider

- **WHEN** a structured verdict is requested from the OpenAI-compatible
  endpoint
- **THEN** the declared JSON Schema is generated from `VerdictSchema` and is
  accepted by the provider

#### Scenario: Strict mode is only declared when satisfiable

- **WHEN** the generated schema does not meet strict-mode constraints
- **THEN** the request does not declare strict mode

### Requirement: HTTP SHALL use the platform fetch implementation

The CLI transport SHALL use the runtime's global `fetch` rather than bundling a
separate HTTP client.

The shutdown workaround that closes a pooled dispatcher to avoid a libuv crash
SHALL be removed along with the dependency that required it.

#### Scenario: A model request succeeds over platform fetch

- **WHEN** the CLI issues a model request
- **THEN** it is performed with the global `fetch` and no third-party HTTP
  client is loaded

#### Scenario: The CLI exits without a dispatcher teardown step

- **WHEN** the CLI completes a run
- **THEN** it exits with the run's status and performs no dispatcher close

#### Scenario: HTTP errors still surface with status and body

- **WHEN** the endpoint returns a non-2xx status
- **THEN** the thrown error names the status code and includes the response
  body

### Requirement: Model calls SHALL be cancellable

`ChatClient.sendText` and `ChatClient.sendStructured` SHALL accept an optional
`AbortSignal` and SHALL pass it to the underlying transport so an in-flight
request is abandoned when the signal aborts.

Implementations SHALL NOT create a cancellation source that no caller can
trigger. Any cancellation source an implementation creates for transport
purposes SHALL be disposed when the call settles.

When a call is aborted the client SHALL throw a typed `ReviewCancelledError`
rather than a transport-specific error, and SHALL NOT attempt the
schema-reminder retry.

#### Scenario: Aborting a signal abandons the in-flight request

- **WHEN** a client call is in flight and its `AbortSignal` aborts
- **THEN** the call rejects with `ReviewCancelledError`

#### Scenario: Abort short-circuits the schema retry

- **WHEN** the first structured attempt fails to parse and the signal aborts
  before the retry is issued
- **THEN** no retry request is sent and the call rejects with
  `ReviewCancelledError`

#### Scenario: Transport cancellation sources are disposed

- **WHEN** a `VscodeLmClient` call settles, whether by success or failure
- **THEN** any `CancellationTokenSource` the client created for that call is
  disposed

### Requirement: The loop SHALL stop between iterations when cancelled

`reviewLoop` SHALL accept an optional `AbortSignal` and SHALL check it before
starting each iteration and before calling the reviewer. On abort it SHALL
return the artifacts and history produced so far with `approved: false` and a
`cancelled: true` marker, rather than throwing.

`runPipeline` SHALL check the same signal between stages and SHALL not begin a
stage after abort.

#### Scenario: Abort before an iteration ends the loop cleanly

- **WHEN** the signal aborts after iteration 1 completes and before iteration 2
  begins
- **THEN** `reviewLoop` returns with `iterations: 1`, `approved: false`,
  `cancelled: true`, and the iteration-1 history intact

#### Scenario: Abort between stages stops the pipeline

- **WHEN** the signal aborts after the PLAN stage completes
- **THEN** the CODE stage is not started and the pipeline result contains only
  the PLAN stage

#### Scenario: An un-aborted run is unaffected

- **WHEN** no signal is supplied, or the supplied signal never aborts
- **THEN** loop and pipeline behaviour is identical to the previous
  implementation

### Requirement: The structured-output retry SHALL show the model its failure

When a structured response fails to parse or validate, the retry SHALL include:

1. the model's own failed response, as an assistant turn, and
2. the validation or parse error that rejected it, and
3. a description of the required schema derived from the schema itself.

A reminder that names a schema without stating it is not sufficient. In
particular, an implementation SHALL NOT fall back to prose such as "the
previously stated structured-verdict schema" when the schema object carries no
description — it SHALL generate the description from the schema.

#### Scenario: Retry echoes the failed response

- **WHEN** a first structured attempt returns unparseable output and a retry is
  issued
- **THEN** the retry messages include the first response as an assistant turn

#### Scenario: Retry states the validation error

- **WHEN** a first structured attempt parses as JSON but fails schema
  validation
- **THEN** the retry messages include the validation error text

#### Scenario: Schema description is generated, not defaulted to prose

- **WHEN** the retry reminder is built for a schema with no `description`
- **THEN** the reminder contains a generated description of the schema's shape
  and not a generic placeholder sentence

### Requirement: Text-producing agents SHALL not impose a JSON envelope

`buildWorker` SHALL request plain text for stages whose product is a document,
and SHALL return the response unchanged. The `WorkerOutputSchema` envelope
SHALL be removed.

`buildReviewer` SHALL continue to request and validate structured output.

#### Scenario: Worker returns the model response unchanged

- **WHEN** a worker built for the PLAN or CODE stage is invoked
- **THEN** the returned artifact is the model's text response with no unwrapping
  step

#### Scenario: Reviewer still validates

- **WHEN** a reviewer is invoked and the model returns output failing the
  verdict schema
- **THEN** the retry-and-two-strike path runs as before

### Requirement: Clients SHALL support a tool-call round trip

`ChatClient` SHALL accept a set of declared tools and SHALL surface tool-call
requests from the model to the caller, accept tool results, and continue the
turn until the model returns a final response.

Both the in-editor transport and the OpenAI-compatible CLI transport SHALL
implement this, so a capability is never available on one surface only.

Every tool loop SHALL be bounded by a maximum number of calls and a wall-clock
deadline. On exceeding either, the client SHALL stop granting tool calls, tell
the model so, and issue one final request with no tools declared, so a turn
that was cut off still produces an answer the caller can use. The client SHALL
report to the caller which limit was hit and how many calls were made.

Withdrawing the tools on that final request is deliberate: a model that still
sees tools answers with another tool call, which leaves `sendStructured`
nothing to parse.

The client SHALL notify the caller that a tool call is about to run, before
invoking it. Reporting only on completion makes a slow call invisible for
exactly as long as it is slow, which reads to a user as a hang.

The client SHALL pass the loop's wall-clock deadline to each invocation, so a
single call can stop itself rather than outliving the budget that bounds the
loop containing it.

#### Scenario: Model requests a tool and receives its result

- **WHEN** a model responds with a tool call and the caller supplies a result
- **THEN** the client continues the same turn and returns the model's
  subsequent response

#### Scenario: Every call in a multi-call turn is answered

- **WHEN** a model requests several tools in one turn
- **THEN** each call receives a result before the next request is issued

#### Scenario: A single turn cannot exceed the call budget

- **WHEN** one turn requests more tools than the remaining budget allows
- **THEN** only the calls within budget are executed
- **AND** each remaining call is answered with a budget-exhausted result rather
  than being invoked

#### Scenario: Call budget terminates the loop

- **WHEN** a model issues more tool calls than the configured budget allows
- **THEN** the client stops issuing calls, makes one final tool-less request,
  and reports the stop reason as budget-exhausted

#### Scenario: Deadline terminates the loop

- **WHEN** a tool loop exceeds its wall-clock deadline
- **THEN** the client stops issuing calls, makes one final tool-less request,
  and reports the stop reason as deadline-exceeded

#### Scenario: A cut-off structured call still yields a parsed object

- **WHEN** a budget is exhausted during `sendStructured`
- **THEN** the final tool-less response is parsed against the schema as usual

#### Scenario: Both transports behave identically

- **WHEN** the same tool-using request is issued through the in-editor and CLI
  transports
- **THEN** both perform the tool round trip and return a final response

#### Scenario: A call is announced before it runs

- **WHEN** a model requests a tool
- **THEN** the caller is notified of the call before the tool is invoked, not
  only once it returns

#### Scenario: The loop's deadline reaches the tool

- **WHEN** a tool is invoked inside a loop bounded by a wall-clock deadline
- **THEN** the invocation receives that deadline

### Requirement: The workspace toolset SHALL be confined and auditable

Agents SHALL be offered a read-only workspace toolset providing at least: read
a file, search file contents, and list a directory.

Every path a tool resolves SHALL be validated to fall within the workspace
root, using the same rules that guard edit application. Paths resolving outside
the root SHALL be refused with a reason, not silently ignored.

The toolset SHALL respect the repository's ignore rules so that build output,
dependency trees, and secret files are not pulled into a prompt.

An ignore policy that answers by running a subprocess SHALL be able to resolve
a whole listing in one call, and the workspace walk SHALL ask it that way. One
subprocess per path turns a tree walk into minutes of work. Batching per
directory is not sufficient on its own; the walk order must be chosen so that
each query covers as many paths as possible.

A search SHALL bound itself by matches found, files walked, and the time budget
of its own invocation. The file cap SHALL count every file the walk visits, not
only those it opens, so narrowing a search by path cannot bypass the cap. When
a search stops for any of these reasons it SHALL say which, so a partial result
is never mistaken for an exhaustive one.

Every tool call and its outcome SHALL be recorded in the run transcript.

#### Scenario: Reading outside the workspace is refused

- **WHEN** an agent requests a path that resolves outside the workspace root
- **THEN** the call is refused with a reason and no file content is returned

#### Scenario: Ignored paths are not readable

- **WHEN** an agent requests a path excluded by the repository's ignore rules
- **THEN** the call is refused and no content is returned

#### Scenario: Tool calls appear in the transcript

- **WHEN** an agent makes tool calls during a run
- **THEN** each call and its outcome is recorded in the transcript

#### Scenario: The toolset cannot write

- **WHEN** the toolset is inspected
- **THEN** it exposes no operation that creates, modifies, or deletes a file

#### Scenario: A tree walk resolves ignore rules in batches

- **WHEN** the walk examines a directory listing under a policy that supports
  batch resolution
- **THEN** the listing is resolved in a single query rather than one per path

#### Scenario: A path-narrowed search still honours the file cap

- **WHEN** a search narrowed by path walks past the configured file cap without
  opening any file
- **THEN** the search stops at the cap and reports that it did so

#### Scenario: A search stops at its invocation deadline

- **WHEN** a search is still walking when its invocation deadline passes
- **THEN** it returns the matches it has and states that the results are partial

### Requirement: The fix proposal SHALL be structured

The fixer SHALL return one entry per reviewer finding, each carrying the
finding's 1-based id, a status of `fixed`, `disagree` or `unaddressed`, an
explanation, and the exact edits that resolve it. Edits SHALL be empty unless
the status is `fixed`.

The Markdown rendition shown to the user and sent to the reviewer for
re-review SHALL be derived from that structure, so the prose and the edits
cannot disagree.

#### Scenario: Edits travel with the explanation

- **WHEN** the fixer resolves a finding
- **THEN** the response carries both the explanation and the exact
  `oldString`/`newString` edits, validated against the schema

#### Scenario: A rebuttal carries no edits

- **WHEN** a fix has status `disagree` or `unaddressed`
- **THEN** its edit list is empty
- **AND** the response fails validation if it is not

#### Scenario: Every finding is answered exactly once

- **WHEN** the fixer responds to N findings
- **THEN** the response carries exactly N entries whose `findingId` values are
  `1..N`, each used once
- **AND** a response that misses, duplicates or invents a `findingId` is
  rejected and the fixer is asked again

#### Scenario: Rendered Markdown is derived, not authored

- **WHEN** the proposal is rendered for display or re-review
- **THEN** the Markdown is generated from the structured response rather than
  written by the model

