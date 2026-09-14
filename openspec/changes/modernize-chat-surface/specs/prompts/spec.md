# prompts spec delta

## MODIFIED Requirements

### Requirement: Markdown-producing workers SHALL return plain text

Worker prompts whose product is Markdown or source code SHALL instruct the
model to reply with that content directly. They SHALL NOT require a
`{"artifact": "<string>"}` JSON envelope.

Requiring an envelope forces the model to JSON-escape an entire document into
a single string field, which costs tokens, introduces escaping defects, and
routes otherwise-valid responses into the schema-retry path. Reviewer
responses remain structured and zod-validated; only the worker's
document-shaped output changes.

#### Scenario: Plan worker returns Markdown directly

- **WHEN** the PLAN worker is invoked
- **THEN** its response is consumed as Markdown, with no JSON envelope to
  unwrap

#### Scenario: Code worker returns code directly

- **WHEN** the CODE worker is invoked
- **THEN** its response is consumed as text containing fenced code blocks,
  with no JSON envelope to unwrap

#### Scenario: Reviewer output remains structured

- **WHEN** any reviewer is invoked
- **THEN** its response is still validated against the verdict schema

### Requirement: The reviewer checklist SHALL name its OWASP edition

The CODE reviewer prompt SHALL state which edition of the OWASP Top 10 its
checklist implements, and the edition SHALL be recorded in the run transcript
so a past review can be audited against the list that was actually applied.

The edition SHALL be reviewed whenever a new OWASP Top 10 is published rather
than left pinned indefinitely.

#### Scenario: Prompt states its edition

- **WHEN** the CODE reviewer prompt is loaded
- **THEN** it names the OWASP Top 10 edition its checklist covers

#### Scenario: Transcript records the edition

- **WHEN** a review run completes
- **THEN** the transcript records the OWASP edition applied by the reviewer
  prompt
