# Capability: sha256-cli

## ADDED Requirements

### Requirement: SHA-256 of stdin to stdout

The CLI SHALL read all bytes from stdin, compute their SHA-256 digest, and write the lowercase hex digest followed by a single `\n` to stdout.

#### Scenario: Known vector for "hello"

- **WHEN** stdin contains the 5 bytes `hello` (no trailing newline)
- **THEN** stdout is `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824\n` AND the exit code is `0`

#### Scenario: Empty input

- **WHEN** stdin is closed with zero bytes read
- **THEN** stdout is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n` AND the exit code is `0`

### Requirement: Error on I/O failure

The CLI SHALL exit with a non-zero status code if reading stdin fails.

#### Scenario: stdin read error

- **WHEN** the underlying stdin stream emits an `error` event before `end`
- **THEN** the CLI writes a one-line message to stderr AND exits with a non-zero status code
