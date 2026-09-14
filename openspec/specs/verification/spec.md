# verification Specification

## Purpose
TBD - created by archiving change add-codecrosscheck. Update Purpose after archive.
## Requirements
### Requirement: Deterministic unit tests

The system SHALL provide unit tests that run without network access AND without real model calls, using a `FakeChatClient` test double whose responses are scripted per-test.

#### Scenario: Tests run offline

- **GIVEN** a clean checkout
- **WHEN** the developer runs `npm test` with no network access
- **THEN** all tests not gated by `RUN_LIVE_TESTS` pass

#### Scenario: FakeChatClient is deterministic

- **GIVEN** the same scripted response queue
- **WHEN** the same test runs twice
- **THEN** both runs produce identical loop history

### Requirement: Loop coverage

The test suite SHALL cover the following loop behaviors with at least one test each: approve-on-first, revise-then-approve, iteration-cap-reached, malformed-then-valid (single retry recovers), and malformed-twice (iteration fails).

#### Scenario: Iteration cap test

- **GIVEN** `FakeChatClient` scripted to return `revise` three times AND `maxIters: 2`
- **WHEN** the loop runs
- **THEN** the result has `approved: false` AND `iterations: 2`

### Requirement: Sandbox behavioral tests

The test suite SHALL include tests that exercise the sandbox's timeout, tempdir isolation, environment scrubbing, and exit-code propagation against real child processes.

#### Scenario: Timeout test kills runaway

- **GIVEN** a script that runs forever AND `timeoutMs: 500`
- **WHEN** `runSandboxed` is invoked
- **THEN** the call returns within 1500 ms AND `exitCode` is non-zero

#### Scenario: Environment scrub test

- **GIVEN** the test process has set `SECRET_KEY=hunter2` in its environment
- **WHEN** `runSandboxed` runs a script that prints its environment
- **THEN** the captured stdout does NOT contain `SECRET_KEY` or `hunter2`

### Requirement: Prompt-contract tests

The test suite SHALL load every prompt file under `src/prompts/` AND assert the structured-verdict schema field names appear, so prompt edits cannot silently drop the JSON contract.

#### Scenario: Reviewer prompt missing schema fails contract test

- **GIVEN** an edit that removes the schema description from `code_reviewer.md`
- **WHEN** the prompt-contract test runs
- **THEN** the test fails with a message naming the offending file

### Requirement: Gated live integration test

The system SHALL include a live integration test that exercises the GitHub Models endpoint with the default model pair. The test SHALL be skipped unless `RUN_LIVE_TESTS=1` AND `GITHUB_TOKEN` are both present in the environment.

#### Scenario: Live test skipped by default

- **WHEN** `npm test` runs without `RUN_LIVE_TESTS`
- **THEN** the live test is reported as skipped, not failed

#### Scenario: Live test passes against real endpoint

- **GIVEN** `RUN_LIVE_TESTS=1` AND a valid `GITHUB_TOKEN`
- **WHEN** `npm test` runs
- **THEN** the live test passes
- **AND** at least one structured verdict is parsed from a real API response

### Requirement: Cross-platform gate

The repository SHALL provide a single `npm run verify` script that runs `npm ci`, `npm run build`, AND `npm test` on Windows, macOS, and Linux without any shell-specific dependencies.

#### Scenario: Verify on Windows

- **GIVEN** a clean Windows checkout with Node 20
- **WHEN** the developer runs `npm run verify`
- **THEN** the script completes successfully without invoking any `.sh` or `.ps1` files

#### Scenario: Verify on Linux

- **GIVEN** a clean Linux checkout with Node 20
- **WHEN** the developer runs `npm run verify`
- **THEN** the script completes successfully

### Requirement: README

The repository SHALL include a top-level `README.md` that documents installation, CLI usage, VS Code participant usage, all `codecrosscheck.*` settings, required environment variables, transcript file location, AND how to enable the live integration test.

#### Scenario: Settings table present

- **WHEN** a developer opens `README.md`
- **THEN** the file contains a section listing every `codecrosscheck.*` setting with its default value AND description

