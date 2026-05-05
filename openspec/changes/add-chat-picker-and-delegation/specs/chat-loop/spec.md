# Capability: chat-loop (delta)

## MODIFIED Requirements

### Requirement: Default model pair

The default worker model SHALL be `openai/gpt-5.4` and the default reviewer
model SHALL be `anthropic/claude-opus-4.6`. These defaults apply to the CLI
flags `--worker-model` / `--reviewer-model` and to the VS Code settings
`codecrosscheck.workerModel` / `codecrosscheck.reviewerModel`.

#### Scenario: CLI uses bumped defaults

- **WHEN** `codecrosscheck "..."` is invoked without `--worker-model` or
  `--reviewer-model`
- **THEN** the worker resolves to `openai/gpt-5.4` and the reviewer to
  `anthropic/claude-opus-4.6`

## ADDED Requirements

### Requirement: --diff flag attaches branch diff to prompt

The CLI SHALL accept `--diff` (boolean) and `--diff-base <ref>` (string) flags.
When `--diff` is set, the CLI SHALL compute the current branch diff against
the merge-base with `origin/main` (or `--diff-base` when provided, falling
back to `HEAD`) and append it to the task prompt. When the diff is empty, the
CLI SHALL warn on stderr and proceed without diff context. When the diff
computation fails, the CLI SHALL exit non-zero with the underlying error.

#### Scenario: Diff appended to prompt

- **GIVEN** a working branch with committed changes ahead of `origin/main`
- **WHEN** `codecrosscheck "review my work" --diff` is invoked
- **THEN** the worker receives a prompt that includes the unified diff of
  the branch
- **AND** the JSONL transcript records the resolved base ref

#### Scenario: Empty diff is non-fatal

- **GIVEN** a branch identical to `origin/main`
- **WHEN** `codecrosscheck "..." --diff` is invoked
- **THEN** the CLI writes a warning to stderr and runs without diff context
- **AND** exits with the same status it would have without `--diff`
