# vscode-extension delta: raise-review-branch-diff-budget

## MODIFIED Requirements

### Requirement: /review-branch SHALL bail before calling the LM when the diff is too large

The `/review-branch` participant command SHALL apply a hard char-budget guard
on the assembled branch diff before any reviewer LM call. The cap SHALL be
governed by the VS Code setting
`codecrosscheck.reviewBranch.maxDiffChars` (integer, default `1100000`,
minimum `0`; `0` disables the guard).

When the diff exceeds the cap, the handler SHALL print a clear chat message
that includes the actual diff size, the configured cap, and at minimum the
following remedies: pass a closer `diff-base=<ref>`, split the branch, or
raise the cap if the reviewer model is known to handle it. The handler SHALL
return without invoking the reviewer.

This guard is independent of the reviewer model — it protects against the
common case where a forgotten `diff-base` produces a multi-megabyte diff that
no reasonable LM can review in one pass. Because the default cap is larger
than the context window of any currently reachable reviewer model, the token
preflight is normally the gate that fires first; this guard remains the only
protection for models that report no `maxInputTokens`.

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
