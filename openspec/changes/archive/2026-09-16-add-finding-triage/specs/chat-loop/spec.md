# chat-loop delta: add-finding-triage

## ADDED Requirements

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
