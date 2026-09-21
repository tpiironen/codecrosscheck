# vscode-extension spec delta

## MODIFIED Requirements

### Requirement: review-branch SHALL offer agents a workspace toolset

The triager and the fixer SHALL be granted the read-only workspace toolset
before each fixer iteration of `/review-branch`, rather than a pre-assembled
block of file contents. Neither agent's prompt SHALL carry a
`# Repository file context` section.

Every tool call SHALL be surfaced in the chat progress stream naming the agent
and the tool, and recorded in the run transcript. The progress line SHALL be
emitted before the call runs, so a call that takes a long time is visible for
the whole time it takes rather than only once it returns.

When an agent's tool budget or deadline is exhausted, the extension SHALL say
so in the chat output, naming the setting that raises the limit.

#### Scenario: Agent reads a file nobody predicted it would need

- **WHEN** the triager finds that judging a finding turns on a file the finding
  never mentions
- **THEN** it reads that file through the toolset and judges the finding,
  rather than returning `uncertain` for want of context

#### Scenario: Agent obtains an unlisted file type

- **WHEN** a finding cites a file whose extension was not in the former
  harvesting allowlist
- **THEN** the agent can still read it and produce a concrete fix

#### Scenario: Tool calls are visible and recorded

- **WHEN** an agent makes tool calls during a run
- **THEN** each call appears in the chat progress stream with the agent and
  tool name
- **AND** each call is recorded in the run transcript

#### Scenario: A slow call is visible while it is slow

- **WHEN** an agent invokes a tool that takes a long time to return
- **THEN** its progress line appears before the call runs, not after it returns

#### Scenario: Exhausted budget is reported to the user

- **WHEN** an agent reaches its tool-call budget or deadline
- **THEN** the chat output states which limit was hit, how many calls were
  made, and which setting raises it
