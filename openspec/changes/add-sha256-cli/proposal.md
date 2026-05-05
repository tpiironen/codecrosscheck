# Add sha256 CLI

> **Note: this is a test fixture, not a product feature.** It exists solely
> as the live target of `npm run selftest:openspec`. The tasks in
> [tasks.md](tasks.md) are intentionally left unchecked and no source code
> under `src/` corresponds to a `sha256-cli` binary. The fixture's only job
> is to be a structurally valid OpenSpec change that
> `openspec validate --strict` accepts, so the selftest can exercise the
> loader, validator pre-gate, change-frame injection, and reviewer wiring
> end-to-end against live GitHub Models.

## Why

We want a tiny illustrative capability used as the live target of the OpenSpec selftest. It must be small enough to fit inside free-tier model token budgets so that the full `--openspec` path (loader, validator pre-gate, change-frame injection, reviewer) can be exercised end-to-end.

## What Changes

This change introduces one **new** capability:

- `sha256-cli` — a single-file Node CLI that reads bytes from stdin, computes the SHA-256 digest, and writes the lowercase hex digest followed by a newline to stdout. Exit code is 0 on success; non-zero on I/O error.

## Impact

- **Affected specs**: one new capability (`sha256-cli`).
- **Affected code**: a single new file under `examples/` (out of scope for this repo; this change exists only as a selftest fixture).
- **Risk surface**: none — illustrative fixture only.
