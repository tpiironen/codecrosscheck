# Tasks: refactor-review-branch-dialogue

All tasks below are complete; this change documents work that landed
after `add-chat-picker-and-delegation` shipped, in response to live-run
feedback that `/review-branch` produced meta-work and gave no closure
when the iteration cap was hit.

## A. Reviewer-first dialogue loop for /review-branch

- [x] A1. Remove `"review-branch": ["plan"]` mapping from
  `SLASH_TO_STAGE` in `src/extension.ts`.
- [x] A2. Add `handleReviewBranch(request, stream, cfg)` in
  `src/extension.ts`. Iteration 1: single CODE-reviewer call on the
  diff. Iterations 2..N: worker fix-proposal call followed by reviewer
  re-judgement.
- [x] A3. Cap by `codecrosscheck.maxIters`. Approve-or-cap termination.
- [x] A4. Persist transcript with `review-branch-iter` and
  `review-branch-done` JSONL events.

## B. Fix-proposal worker plumbing

- [x] B1. Add `loadPromptByName(name)` and
  `buildWorkerWithPrompt(system, client)` exports in `src/agents.ts`.
- [x] B2. Author `src/prompts/review_branch_fixer.md`. Plain Markdown
  output (no JSON envelope), one section per reviewer finding, no
  planning meta-work.
- [x] B3. Wire the fixer prompt + worker into `handleReviewBranch`.

## C. Plain-text ChatClient path

- [x] C1. Add `sendText(messages: ChatMessage[]): Promise<string>` to
  the `ChatClient` interface in `src/clients/ChatClient.ts`.
- [x] C2. Implement `sendText` on `VscodeLmClient` (extract shared
  `select` + `sendRaw` private helpers).
- [x] C3. Implement `sendText` on `GithubModelsClient` (POST without
  `response_format`).
- [x] C4. Switch `buildWorkerWithPrompt` to `sendText`.
- [x] C5. Update `FakeChatClient` test double to support `sendText`.

## D. Final summary card and live streaming

- [x] D1. Replace the `Done. approved=<bool>` final line in the main
  chat handler with a summary card: outcome banner, totals, severity
  counts, full final artifact in `<details>`, transcript link.
- [x] D2. Add severity-grouping helper `countSeverities(verdict)` and
  reuse in both `handleReviewBranch` and the main handler.
- [x] D3. Add live callbacks to `reviewLoop`:
  `onIterationStart`, `onWorkerStart`, `onWorkerEnd`,
  `onReviewerStart`, `onReviewerEnd`. `onReviewerStart` is skipped
  when the pre-review hook synthesizes a verdict.
- [x] D4. Expand `PipelineEvent` union with `iteration-start`,
  `worker-start`, `reviewer-start`. Fire events live; remove
  post-stage batching.
- [x] D5. Render live progress in `extension.ts`: per-iteration
  headers, `stream.progress(...)` while calls are in flight,
  severity-icon issue lists, truncated worker artifacts.

## E. Configuration default

- [x] E1. Change `codecrosscheck.reviewerModel` default from
  `anthropic/claude-opus-4.6` to `openai/gpt-5.4` in `package.json`.

## F. Documentation

- [x] F1. Update `CHANGELOG.md` `[Unreleased]` with the dialogue-loop
  refactor, summary card, live streaming, `sendText`, JSON-envelope
  fix, and reviewer-default change.
- [x] F2. Update `README.md` `/review-branch` description.
- [x] F3. Update `docs/ARCHITECTURE.md` flowchart node and prose for
  the dedicated handler.

## G. Validation

- [x] G1. `tsc` clean.
- [x] G2. `vitest run` green: 19 passed / 8 skipped.
- [x] G3. `openspec validate refactor-review-branch-dialogue --strict`
  passes.
- [x] G4. Manual smoke test in Extension Development Host on the
  Zure.Portal feature branch (334 KB diff). Iteration 1 produced
  6 findings with accurate file:line. Iteration 2 produced a fix
  proposal in plain Markdown.
