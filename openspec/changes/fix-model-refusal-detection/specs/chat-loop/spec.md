# Capability: chat-loop (delta)

## ADDED Requirements

### Requirement: Structured-response clients SHALL detect model refusals before JSON parsing

Structured-response clients SHALL inspect each raw model response (initial
attempt and retry) for a content-policy refusal pattern before attempting
JSON parsing. This applies to both `VscodeLmClient.sendStructured` and
`GithubModelsClient.sendStructured`. When a refusal is detected, the client
SHALL throw a `ModelRefusalError` carrying the model id and a truncated
snippet of the response. A refusal on the initial attempt SHALL NOT
trigger the schema-reminder retry — the second attempt is guaranteed to
fail the same way and only burns tokens.

The refusal detector SHALL be conservative: it SHALL only fire when the
refusal phrasing appears at the start of the response (optionally after a
fence opener), so that legitimate JSON payloads containing the word
"sorry" inside string values are NOT misclassified.

#### Scenario: Plain-prose refusal short-circuits the retry

- **GIVEN** a worker model that responds with
  `Sorry, I can't assist with that.`
- **WHEN** `sendStructured` is called with any schema
- **THEN** the call SHALL throw a `ModelRefusalError`
- **AND** no schema-reminder retry SHALL be issued
- **AND** the error message SHALL include the model id and a snippet of the
  refusal text

#### Scenario: Fenced refusal is detected even when wrapped in an unknown language tag

- **GIVEN** a model response of ` ```text\nSorry, I can't help with that.\n``` `
- **WHEN** `sendStructured` is called
- **THEN** the call SHALL throw a `ModelRefusalError`
- **AND** the error message SHALL NOT be a `JSON.parse` "Unexpected token"
  error

#### Scenario: Valid JSON containing the word "sorry" is NOT flagged as a refusal

- **GIVEN** a model response of `{"artifact": "sorry that was confusing"}`
- **WHEN** `sendStructured` is called with a schema accepting that shape
- **THEN** the call SHALL return the parsed object
- **AND** SHALL NOT throw `ModelRefusalError`

### Requirement: Fence extraction SHALL only unwrap json-labelled or unlabelled fences

The `extractJson` helper in `VscodeLmClient` SHALL match the regex
`/```(?:json)?\r?\n([\s\S]*?)```/` — i.e. the opening fence is either
``` ```json ``` or ``` ``` ``` followed by a newline, and the closing fence
is `` ``` ``. Unknown language tags such as `text`, `yaml`, or `markdown`
SHALL NOT be unwrapped; the helper SHALL fall through to the brace-pair
fallback or raw-trim path for those cases.

#### Scenario: Unknown-fence prose falls through, not silently unwrapped

- **GIVEN** a model response of ` ```text\nHere is some prose.\n``` `
- **WHEN** `extractJson` is invoked on that string
- **THEN** the returned value SHALL NOT be `text\nHere is some prose.\n`
- **AND** the subsequent `JSON.parse` SHALL fail on the full response,
  producing a clear two-strike error that includes a snippet of the raw
  response

### Requirement: Two-strike structured-response failures SHALL include raw snippets

Two-strike structured-response failures SHALL produce an error message that
includes a single-line, whitespace-collapsed snippet (≤160 characters) of
each attempt's raw response, in addition to the parse/validation error
messages. This applies when both `sendStructured` attempts fail without
producing a refusal. The snippets let users diagnose schema drift or
unexpected formats from chat output alone, without opening the transcript.

#### Scenario: Two-strike failure includes both raw snippets

- **GIVEN** a model that returns non-JSON, non-refusal prose on both
  attempts
- **WHEN** `sendStructured` is called
- **THEN** the thrown `Error.message` SHALL contain the substring
  `failed schema "<name>" twice`
- **AND** SHALL contain a `(raw: ...)` snippet for each attempt
