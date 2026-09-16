# chat-loop spec delta

## ADDED Requirements

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
