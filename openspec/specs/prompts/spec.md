# prompts Specification

## Purpose
TBD - created by archiving change add-codecrosscheck. Update Purpose after archive.
## Requirements
### Requirement: Stage-specific reviewer prompts

Each pipeline stage SHALL have a dedicated reviewer system prompt that enforces a stage-specific checklist. Prompts SHALL be stored as Markdown files under `src/prompts/<stage>_reviewer.md` AND SHALL be loaded at agent build time. When invoked with an OpenSpec frame (a `change` block AND optionally a `diff` block in the input), the prompt's checklist SHALL additionally enforce alignment with the loaded change's `proposal.md`, `tasks.md`, AND spec deltas.

#### Scenario: Plan reviewer flags missing verification

- **GIVEN** the plan reviewer prompt
- **WHEN** judging a plan that omits a verification section
- **THEN** the verdict is `revise`
- **AND** at least one issue has `severity: "high"` AND a `where` field pointing at the verification gap

#### Scenario: Code reviewer flags OWASP A01

- **GIVEN** the code reviewer prompt
- **WHEN** judging code that allows unauthenticated access to a privileged endpoint
- **THEN** the verdict is `revise`
- **AND** at least one issue mentions broken access control

#### Scenario: Execute reviewer flags silent failure

- **GIVEN** the execute reviewer prompt
- **WHEN** judging an execution result with `exitCode: 0` AND `stderr` containing `ERROR`
- **THEN** the verdict is `revise`

#### Scenario: Code reviewer flags scope creep with OpenSpec frame

- **GIVEN** a change whose impact lists only `src/loop.ts`
- **AND** a diff that ALSO modifies `src/unrelated.ts`
- **WHEN** the code reviewer judges with the OpenSpec frame attached
- **THEN** the verdict is `revise`
- **AND** at least one issue has `severity: "high"` AND mentions scope creep

#### Scenario: Plan reviewer flags task gap with OpenSpec frame

- **GIVEN** a change whose `tasks.md` omits a task that the proposal's "What Changes" lists
- **WHEN** the plan reviewer judges the worker's plan with the OpenSpec frame
- **THEN** the verdict is `revise`
- **AND** an issue points at the missing task

### Requirement: Skeptical-by-default persona

All reviewer prompts SHALL instruct the model to default to skeptical, to refuse sycophantic approval, AND to require explicit evidence before issuing `verdict: "approve"`.

#### Scenario: Plausible-but-flawed plan does not auto-approve

- **GIVEN** a plan that reads plausibly but omits handling of a known edge case
- **WHEN** the plan reviewer judges it
- **THEN** the verdict is `revise`

### Requirement: Ground-truth clause for code reviewer

The code reviewer prompt SHALL state that the approved plan is the canonical ground truth for correctness, AND that style critiques alone SHALL NOT justify a `revise` verdict.

#### Scenario: Style-only critique does not block approval

- **GIVEN** code that fully implements the approved plan AND has no correctness or security issues
- **WHEN** the reviewer's only objections are stylistic
- **THEN** the verdict is `approve`

### Requirement: Output contract reinforcement

Every reviewer prompt SHALL include the structured-verdict JSON schema description AND instruct the model to emit ONLY that JSON, with no surrounding prose.

#### Scenario: Reviewer asked for prose still emits JSON

- **GIVEN** a fixture that includes the phrase "Please explain your reasoning in prose"
- **WHEN** the reviewer judges it
- **THEN** the response parses as the structured verdict schema

### Requirement: Worker prompts per stage

Each stage SHALL have a worker system prompt at `src/prompts/<stage>_worker.md` that constrains the worker's output format (plan structure for `PLAN`, code-only blocks for `CODE`, executable command for `EXECUTE`).

#### Scenario: Code worker emits only code

- **WHEN** the code worker is invoked
- **THEN** the response contains only fenced code blocks AND no surrounding prose

### Requirement: Test corpus

A planted-flaw corpus SHALL exist at `test/corpus/{plans,code,execute,openspec}/<case>/` where each case directory contains the artifact under test AND an `expected.json` describing which issues the reviewer is required to flag. The `openspec/` subtree SHALL include cases for `good`, `missing-scenario`, `scope-creep`, AND `wrong-marker`.

#### Scenario: Corpus expectation file is well-formed

- **GIVEN** any corpus case directory
- **WHEN** its `expected.json` is loaded
- **THEN** it parses as JSON
- **AND** it contains a list of expected issues each with `severity` AND a substring match for `where`

#### Scenario: Wrong-marker case fails at pre-gate

- **GIVEN** the `wrong-marker` corpus fixture (uses `## Added Requirements` instead of `## ADDED Requirements`)
- **WHEN** the OpenSpec pre-gate runs
- **THEN** validation fails
- **AND** the reviewer model is NOT called for that iteration

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

### Requirement: Grounding rules SHALL be reduced to what tools do not guarantee

The fixer prompt SHALL be reduced to the grounding rules that tool access does
not already provide: that an identifier must exist in source the worker has
actually read, and that a change assumed from an earlier round must be included
in the current one.

`review_branch_fixer.md` currently devotes its longest rule to forbidding the
model from referencing identifiers it was not handed, because pre-injection
could not guarantee the model had the relevant source. Once the worker can read
the workspace on demand, that reasoning no longer holds.

The instruction not to respond with "Data I need" placeholders SHALL be
removed, because the condition it describes can no longer arise.

#### Scenario: Fixer is told to read rather than told not to invent

- **WHEN** the fixer prompt is loaded
- **THEN** it directs the worker to read the source it needs through the
  toolset, and does not enumerate placeholder phrases to avoid

#### Scenario: Self-contained-round rule is retained

- **WHEN** the fixer prompt is loaded
- **THEN** it still requires each round to be a complete, self-contained
  proposal

