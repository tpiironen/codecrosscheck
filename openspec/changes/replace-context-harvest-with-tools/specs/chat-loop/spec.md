# chat-loop spec delta

## ADDED Requirements

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

#### Scenario: Model requests a tool and receives its result

- **WHEN** a model responds with a tool call and the caller supplies a result
- **THEN** the client continues the same turn and returns the model's
  subsequent response

#### Scenario: Every call in a multi-call turn is answered

- **WHEN** a model requests several tools in one turn
- **THEN** each call receives a result before the next request is issued

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

### Requirement: The workspace toolset SHALL be confined and auditable

Agents SHALL be offered a read-only workspace toolset providing at least: read
a file, search file contents, and list a directory.

Every path a tool resolves SHALL be validated to fall within the workspace
root, using the same rules that guard edit application. Paths resolving outside
the root SHALL be refused with a reason, not silently ignored.

The toolset SHALL respect the repository's ignore rules so that build output,
dependency trees, and secret files are not pulled into a prompt.

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

#### Scenario: Rendered Markdown is derived, not authored

- **WHEN** the proposal is rendered for display or re-review
- **THEN** the Markdown is generated from the structured response rather than
  written by the model

## MODIFIED Requirements

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
