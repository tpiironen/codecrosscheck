# chat-loop spec delta

## MODIFIED Requirements

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
