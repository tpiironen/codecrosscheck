# Tasks

## A. Token-limit short-circuit in clients
- [x] A1. Add `OversizedPromptError` class to `src/clients/vscodeLm.ts`.
- [x] A2. Add `OVERSIZED_PATTERNS` regex list and exported `assertNotOversized` helper.
- [x] A3. Call `assertNotOversized` in `VscodeLmClient.sendStructured` after both
       parse attempts so the schema-reminder retry is skipped on token-limit failures.
- [x] A4. Mirror the same wiring in `GithubModelsClient.sendStructured`.

## B. `/review-branch` hard char-budget guard
- [x] B1. Add `codecrosscheck.reviewBranch.maxDiffChars` setting to `package.json`
       (integer, default `200000`, `minimum: 0`, `0` disables).
- [x] B2. In `handleReviewBranch`, after `getChangeDiff`, bail with a clear chat
       message when `diff.length > maxDiffChars`. Suggest `diff-base=<ref>` and
       splitting the branch.

## C. `/review-branch` token preflight
- [x] C1. Best-effort lookup of `lm.selectChatModels({ family: reviewerFamily })`
       and read `maxInputTokens` + `countTokens`. Wrap in try/catch so older VS
       Code or missing APIs are silently ignored.
- [x] C2. Compute prompt tokens for the assembled `taskHeader + diffBlock` and
       abort when tokens > `floor(maxInputTokens * 0.9)`.

## D. Tests
- [x] D1. Add `test/oversized.test.ts` covering:
        - First-attempt token-limit error throws `OversizedPromptError` and
          calls `sendRequest` only once (retry is skipped).
        - Multiple provider phrasings match (`Message exceeds token limit`,
          `maximum context length`, `prompt is too long`, `request too large`,
          `context window exceeded`).
        - Unrelated errors (`ECONNRESET`, parse errors) are NOT misclassified.
        - The error message names the model id and mentions `diff-base`.

## E. Docs & changelog
- [x] E1. CHANGELOG: new `Fixed` entry under `[Unreleased]` describing the
       guard, preflight, and skip-retry behaviour.
- [x] E2. docs/ARCHITECTURE.md: extend the refusal short-circuit bullet to
       cover `OversizedPromptError` and reference this change.
