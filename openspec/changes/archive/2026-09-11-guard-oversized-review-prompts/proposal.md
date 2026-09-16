# Guard oversized review-branch prompts

## Why

`/review-branch` currently passes the entire branch diff to the reviewer LM as
one user message, with no size guard. On a 1.3 MB diff the reviewer call fails
with `Message exceeds token limit.` (empty body), the structured-output retry
re-sends the same oversized prompt with a schema reminder, and the second
attempt returns either `{"verdict":"unknown"}` or
`{"verdict":"invalid","reason":"No previously stated structured-verdict schema is available in this conversation."}`.
The two-strike fallback then surfaces a confusing Zod validation error that
hides the real cause (the prompt did not fit in the context window).

The `fix-model-refusal-detection` change short-circuits content-policy
refusals, but a token-limit failure is a different class of error and still
runs through the wasted retry.

## What Changes

- **MODIFIED capability `chat-loop`**: structured-response clients
  (`VscodeLmClient.sendStructured`, `GithubModelsClient.sendStructured`) SHALL
  detect token-limit / context-window-exceeded errors from the underlying
  transport and throw a new typed `OversizedPromptError` *without* attempting
  the schema-reminder retry. The error message SHALL name the model and
  suggest concrete remediation (`diff-base=<closer-ref>`, split the branch,
  pick a larger reviewer model).
- **MODIFIED capability `vscode-extension`**: the `/review-branch` handler
  SHALL apply a hard character-budget guard before calling the reviewer,
  governed by a new `codecrosscheck.reviewBranch.maxDiffChars` setting
  (default `200000`, `0` disables). When the diff exceeds the cap the handler
  SHALL abort with guidance and SHALL NOT call the LM.
- **MODIFIED capability `vscode-extension`**: when the reviewer model exposes
  `countTokens` and `maxInputTokens`, `/review-branch` SHALL run a best-effort
  token preflight on the assembled prompt and abort with a typed message when
  the prompt would consume more than 90% of `maxInputTokens` (reserving
  headroom for the response).

## Impact

- Affected specs: `chat-loop`, `vscode-extension`.
- Affected code: `src/clients/vscodeLm.ts`, `src/clients/githubModels.ts`,
  `src/extension.ts`, `package.json` (new setting).
- Affected tests: new `test/oversized.test.ts` (4 cases). Existing
  `test/refusal.test.ts` unchanged.
- User-visible change: `/review-branch` on a too-large diff now prints a clear
  remediation message instead of a misleading Zod schema error. New
  configuration setting `codecrosscheck.reviewBranch.maxDiffChars`.
