# chat-loop delta: fix-retry-without-response

## MODIFIED Requirements

### Requirement: The structured-output retry SHALL show the model its failure

When a structured response fails to parse or validate, the retry SHALL include:

1. the model's own failed response, as an assistant turn, and
2. the validation or parse error that rejected it, and
3. a description of the required schema derived from the schema itself.

A reminder that names a schema without stating it is not sufficient. In
particular, an implementation SHALL NOT fall back to prose such as "the
previously stated structured-verdict schema" when the schema object carries no
description — it SHALL generate the description from the schema.

When the first attempt produced **no response text at all** — because it threw
before returning, for example on a transport error or an empty message body —
there is no failed response to echo. In that case the retry SHALL re-send the
original messages unchanged. It SHALL NOT append an empty assistant turn, and
it SHALL NOT assert that a response failed to parse. A prompt that describes a
response the model never produced is a false premise, and the transport error
that actually occurred cannot be corrected by a schema reminder.

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

#### Scenario: No response produced means the original messages are re-sent

- **GIVEN** a first structured attempt that throws before returning any text
- **WHEN** the retry is issued
- **THEN** the retry messages are identical to the original messages
- **AND** they contain no empty assistant turn
- **AND** they contain no reminder claiming the response was not valid JSON
