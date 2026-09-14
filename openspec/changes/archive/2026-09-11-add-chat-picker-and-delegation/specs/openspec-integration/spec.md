# Capability: openspec-integration (delta)

## ADDED Requirements

### Requirement: changeId input validation before spawn

`validateStrict(changeId)` SHALL reject any `changeId` that does not match
the regex `^[A-Za-z0-9._-]+$` before invoking `child_process.spawn`. This
guard exists because the spawn call uses `shell: true` (required on Windows
to launch `openspec.cmd` shims after Node 22's CVE-2024-27980 hardening),
which would otherwise allow shell-injection from unvalidated chat input.

#### Scenario: Valid changeId passes through

- **WHEN** `validateStrict("add-sha256-cli")` is called
- **THEN** the regex passes and `openspec validate --strict add-sha256-cli`
  is spawned

#### Scenario: Injection attempt is rejected

- **WHEN** `validateStrict("foo; rm -rf /")` is called
- **THEN** the function throws a descriptive error before any process is
  spawned
- **AND** the error message names the offending input

### Requirement: selftest:openspec live harness

The repository SHALL provide an `npm run selftest:openspec` script that
runs an end-to-end PLAN against the `add-sha256-cli` fixture under
`openspec/changes/`. The script SHALL exit non-zero if the validator
pre-gate, OpenSpec frame injection, or reviewer wiring fails. The script
SHALL be opt-in (requires `GITHUB_TOKEN`) and SHALL clean up the undici
global dispatcher on completion to avoid hanging on Windows.

#### Scenario: Selftest passes against live GitHub Models

- **GIVEN** `GITHUB_TOKEN` with `models:read` scope is set
- **WHEN** `npm run selftest:openspec` is run
- **THEN** the script reports a structured verdict from the reviewer
- **AND** exits with status 0
- **AND** the process terminates promptly on Windows
