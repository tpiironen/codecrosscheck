# Change: raise-review-branch-diff-budget

## Why

`codecrosscheck.reviewBranch.maxDiffChars` defaults to `200000`, which is too
small for the branches this tool is actually pointed at. A routine working
tree on this repository measures 500,662 chars, so `/review-branch` aborts
before making a single model call, and the user has to discover and raise the
setting by hand before the tool can be used at all.

The cap was introduced as a cheap pre-filter, not as the real limit. The
accurate check is the token preflight immediately after it, which asks the
selected reviewer model for its own `maxInputTokens` and counts the prompt
against 90% of it. A char count cannot know the reviewer's context window; the
preflight can.

## What Changes

- Default `codecrosscheck.reviewBranch.maxDiffChars` becomes `1100000`.
- No change to the guard's logic, its message, or the `0`-disables behaviour.

## Impact

- Affected specs: `vscode-extension` (the requirement states the default).
- Affected code: `package.json`, `src/config.ts`. `test/config.test.ts`
  asserts manifest/`DEFAULTS` parity dynamically and needs no edit.
- **Accepted trade-off:** at 1,100,000 chars (roughly 275k–310k tokens) the cap
  sits above every context window currently offered through `vscode.lm`, so in
  practice the char guard stops catching oversized prompts and the token
  preflight becomes the effective gate. That is the better gate — but it is
  explicitly *best effort*: `tokenPreflight` returns `null`, allowing the call,
  when the model exposes no `maxInputTokens` or when `countTokens` throws. For
  those models the raised default reintroduces the original failure mode of a
  reviewer LM replying "Message exceeds token limit". Users who want the old
  belt-and-braces behaviour can set the value back down.
- Anyone who had raised the setting manually is unaffected; an explicit value
  still wins over the default.
