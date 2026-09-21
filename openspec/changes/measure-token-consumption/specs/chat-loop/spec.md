# chat-loop delta: measure-token-consumption

## ADDED Requirements

### Requirement: Model calls SHALL record their prompt size

Every model call the project makes SHALL record the size of the prompt it sent
in the run transcript. The record SHALL name the agent and the model id, and
SHALL carry the prompt's character count.

Where the provider can report a token count, the record SHALL carry it too.
Token counting SHALL be best-effort: a provider that cannot count, or whose
counting call throws, SHALL yield a record with the character count alone and
SHALL NOT fail the run. This matches the existing oversized preflight, which
already proceeds when `countTokens` throws.

The oversized preflight SHALL record the token count it computes rather than
using it only for a warning and discarding it.

A run's terminal transcript event SHALL carry the run's total recorded prompt
characters and, where available, total tokens, so the cost of a run is a field
rather than a summation the reader must perform.

Recording SHALL NOT change any budget, cap or limit. Six changes have already
traded prompt size against review quality with no measurement available to
judge them; this requirement supplies the measurement and decides nothing else.

#### Scenario: A call records its size

- **WHEN** an agent makes a model call during `/review-branch`
- **THEN** the transcript contains a record naming the agent, the model id and
  the prompt's character count

#### Scenario: Token count recorded when the provider supplies one

- **GIVEN** a model that reports a token count for a prompt
- **WHEN** a call is made
- **THEN** the record carries that token count alongside the character count

#### Scenario: A provider that cannot count tokens does not fail the run

- **GIVEN** a model whose token-counting call throws
- **WHEN** a call is made
- **THEN** the record carries the character count with no token count
- **AND** the run proceeds normally

#### Scenario: The preflight's count is not discarded

- **WHEN** the oversized preflight computes a token count for a reviewer prompt
- **THEN** that count appears in the transcript, whether or not it exceeded the
  budget

#### Scenario: The run total is available without summation

- **WHEN** a `/review-branch` run completes
- **THEN** its terminal transcript event carries the run's total recorded
  prompt characters
