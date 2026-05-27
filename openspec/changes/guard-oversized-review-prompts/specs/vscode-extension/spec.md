# vscode-extension spec delta

## MODIFIED Requirements

### Requirement: /review-branch SHALL bail before calling the LM when the diff is too large

The `/review-branch` participant command SHALL apply a hard char-budget guard
on the assembled branch diff before any reviewer LM call. The cap SHALL be
governed by the new VS Code setting
`codecrosscheck.reviewBranch.maxDiffChars` (integer, default `200000`,
minimum `0`; `0` disables the guard).

When the diff exceeds the cap, the handler SHALL print a clear chat message
that includes the actual diff size, the configured cap, and at minimum the
following remedies: pass a closer `diff-base=<ref>`, split the branch, or
raise the cap if the reviewer model is known to handle it. The handler SHALL
return without invoking the reviewer.

This guard is independent of the reviewer model — it protects against the
common case where a forgotten `diff-base` produces a multi-megabyte diff that
no reasonable LM can review in one pass.

#### Scenario: Diff over the configured cap aborts before the LM call

- **WHEN** the user runs `@codecrosscheck /review-branch` and the assembled
  branch diff is larger than `codecrosscheck.reviewBranch.maxDiffChars`
- **THEN** the handler prints an error message containing the actual diff
  size, the cap, and `diff-base=` guidance, and SHALL NOT call the reviewer
  LM

#### Scenario: maxDiffChars=0 disables the guard

- **WHEN** `codecrosscheck.reviewBranch.maxDiffChars` is `0`
- **THEN** the char-budget guard is skipped regardless of diff size (the
  token preflight may still abort the run)

### Requirement: /review-branch SHALL run a best-effort token preflight on the reviewer model

The `/review-branch` participant command SHALL run a best-effort token
preflight on the assembled reviewer prompt before calling the reviewer LM.
When the reviewer model exposes `countTokens(text)` and `maxInputTokens`
(VS Code 1.93+ `LanguageModelChat`), the handler SHALL measure the prompt
and abort with a typed chat message when the prompt would consume more than
90% of `maxInputTokens` (the remaining 10% is reserved for the response).

The preflight SHALL be best-effort: if the model does not expose the API,
`countTokens` throws, or the VS Code module cannot be imported, the
preflight SHALL be skipped silently and the normal call path runs.

The abort message SHALL include the measured token count, the budget, the
reviewer model id, and remediation guidance (`diff-base=<ref>`, pick a
larger reviewer via `codecrosscheck.reviewerModel`, or split the branch).

#### Scenario: Prompt exceeding 90% of maxInputTokens aborts

- **WHEN** the reviewer model reports `maxInputTokens = 100000` and
  `countTokens(prompt)` returns `95000`
- **THEN** `/review-branch` prints an abort message naming the token count
  and budget and SHALL NOT call `reviewer.judge`

#### Scenario: countTokens unavailable falls through silently

- **WHEN** the reviewer model has no `countTokens` method (or it throws)
- **THEN** the preflight is skipped without surfacing an error and the
  reviewer call proceeds normally

#### Scenario: Prompt under budget proceeds normally

- **WHEN** `countTokens(prompt)` returns a value at or below
  `floor(maxInputTokens * 0.9)`
- **THEN** the preflight passes and `reviewer.judge` is called with the
  assembled prompt
