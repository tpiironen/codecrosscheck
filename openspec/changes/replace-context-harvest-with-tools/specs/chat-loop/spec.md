# chat-loop spec delta

## ADDED Requirements

### Requirement: Clients SHALL support a tool-call round trip

`ChatClient` SHALL accept a set of declared tools and SHALL surface tool-call
requests from the model to the caller, accept tool results, and continue the
turn until the model returns a final response.

Both the in-editor transport and the OpenAI-compatible CLI transport SHALL
implement this, so a capability is never available on one surface only.

Every tool loop SHALL be bounded by a maximum number of calls and a wall-clock
deadline. On exceeding either, the client SHALL return the model's last text
response with an explicit marker that the tool budget was exhausted, rather
than looping.

#### Scenario: Model requests a tool and receives its result

- **WHEN** a model responds with a tool call and the caller supplies a result
- **THEN** the client continues the same turn and returns the model's
  subsequent response

#### Scenario: Call budget terminates the loop

- **WHEN** a model issues more tool calls than the configured budget allows
- **THEN** the client stops issuing calls and returns a response marked as
  budget-exhausted

#### Scenario: Deadline terminates the loop

- **WHEN** a tool loop exceeds its wall-clock deadline
- **THEN** the client stops issuing calls and returns a response marked as
  deadline-exceeded

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
