# Tasks

## A. Cancellable clients
- [x] A1. Add an optional `signal?: AbortSignal` parameter to
       `ChatClient.sendText` and `ChatClient.sendStructured`.
- [x] A2. Add `ReviewCancelledError` and throw it from both clients on abort.
- [x] A3. `VscodeLmClient`: create a `CancellationTokenSource` per call, cancel
       it when the signal aborts, and dispose it in a `finally`.
- [x] A4. `GithubModelsClient`: pass the signal through to `undici`/`fetch`.
- [x] A5. Skip the schema-reminder retry when the signal is already aborted.

## B. Cancellable loop and pipeline
- [x] B1. Add `signal?: AbortSignal` to `LoopOptions`; check before each
       iteration and before the reviewer call.
- [x] B2. Add `cancelled: boolean` to `LoopResult` and return partial history
       rather than throwing.
- [x] B3. Thread the signal through `Worker.produce` / `Reviewer.judge` and
       `buildWorker` / `buildReviewer`.
- [x] B4. Add `signal` to `PipelineOptions`; do not start a stage after abort.
- [x] B5. Tests: abort between iterations, abort between stages, and an
       un-aborted control case.

## C. Handler wiring
- [x] C1. Convert the request `CancellationToken` to an `AbortSignal` and pass
       it from every handler (`/plan`, `/code`, `/execute`, `/review-branch`,
       `/apply-review`, `/openspec-review`).
- [x] C2. Add `cancelled` to the review outcome union and render it.
- [x] C3. Record the cancelled outcome in the terminating transcript event.

## D. Working-tree diff
- [x] D1. Change `getChangeDiff` to return `{ patch, description }`.
- [x] D2. Include working-tree state by default by diffing the resolved base
       against the working tree; add a `committedOnly` option for the old
       behaviour.
- [x] D3. Drop the redundant three-dot range now that `base` is already a
       resolved merge-base commit.
- [x] D4. Render `description` in the `/review-branch` header and in the
       `# Branch diff` block title.
- [x] D5. Update `src/cli.ts` `--diff` to use the new return shape.
- [x] D6. Tests: unstaged included, staged included, untracked excluded,
       `committedOnly` excludes working tree, description names the base.

## E. Docs
- [x] E1. CHANGELOG entries for cancellation and working-tree review.
- [x] E2. `.github/copilot-instructions.md`: confirmed the existing "on the
       working tree" wording now matches behaviour — it did not before this
       change, because the diff covered committed history only. No edit needed.
- [x] E3. docs/ARCHITECTURE.md: document the cancellation path.
