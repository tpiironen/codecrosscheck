# openspec-integration delta: replace-github-models-with-openai-compatible

## MODIFIED Requirements

### Requirement: selftest:openspec live harness

The repository SHALL provide an `npm run selftest:openspec` script that
runs an end-to-end PLAN against the `add-sha256-cli` fixture under
`openspec/changes/`. The script SHALL exit non-zero if the validator
pre-gate, OpenSpec frame injection, or reviewer wiring fails. The script
SHALL be opt-in, requiring a configured OpenAI-compatible base URL, and SHALL
skip with a clear message rather than failing when none is configured.

The script SHALL NOT require any provider-specific credential. It SHALL NOT
perform transport teardown for `undici`, which the project no longer uses; the
platform `fetch` needs no such cleanup.

#### Scenario: Selftest runs against a configured endpoint

- **GIVEN** an OpenAI-compatible base URL is configured
- **WHEN** `npm run selftest:openspec` is run
- **THEN** the script reports a structured verdict from the reviewer
- **AND** exits with status 0
- **AND** the process terminates promptly on Windows

#### Scenario: Selftest skips without an endpoint

- **GIVEN** no base URL is configured
- **WHEN** `npm run selftest:openspec` is run
- **THEN** the script reports that it was skipped and why
- **AND** does not report a failure
