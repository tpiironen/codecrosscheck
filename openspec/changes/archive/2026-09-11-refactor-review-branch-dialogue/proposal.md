# Refactor /review-branch into a reviewer-first dialogue loop

## Why

Real-world use of `/review-branch` after `add-chat-picker-and-delegation`
shipped exposed two fundamental problems with the original
"attach diff, run PLAN stage" design:

1. **Meta-work spiral.** PLAN's worker prompt produces *implementation
   plans*; PLAN's reviewer prompt critiques *planning rigor*. Pointing
   that loop at a branch diff caused the worker to write progressively
   more elaborate plans about *how* it would review the branch, while
   the reviewer flagged scope creep and missing traceability matrices in
   the planning document. Three iterations consumed and not a single
   line of actual code was reviewed. A live transcript on a 334 KB
   Zure.Portal feature branch ended at the iteration cap with
   `approved=false` and zero findings about the diff itself.

2. **No closure when the cap is hit.** The original handler ended with
   `Done. approved=false. Transcript: <link>`. No final artifact, no
   list of remaining issues, no time spent, no guidance on what to do
   next. Users were left without anything actionable when the loop did
   not converge.

A third issue surfaced once we tried to fix #1 by having a worker
produce a Markdown fix proposal: the structured `WorkerOutput` envelope
(`{"artifact": "..."}`) failed parsing on every retry, because workers
returning multi-section Markdown with embedded code blocks routinely
drop the JSON wrapper when the input is large. The structured-output
retry path is not robust for large-context Markdown deliverables.

## What Changes

This change extends two existing capabilities and adds no new ones.

- **`vscode-extension`** (extended)
  - The `/review-branch` slash command no longer runs the PLAN stage.
    It runs a dedicated reviewer-first dialogue loop:
    - **Iteration 1**: a single CODE-reviewer pass directly on the
      branch diff. The reviewer's verdict is the initial review.
    - **Iterations 2..N**: when the prior verdict is `revise`, the
      worker (the Copilot Chat picker model when
      `useChatPickerWorker=true`, otherwise `codecrosscheck.workerModel`)
      receives the diff, the reviewer's findings, and any prior fix
      proposal. It produces a concrete fix proposal addressing every
      finding, formatted per the new `review_branch_fixer` prompt. The
      reviewer then re-judges whether the proposal resolves every
      finding without introducing new issues; only `approve` when it
      does.
    - The loop terminates when the reviewer approves or
      `codecrosscheck.maxIters` (default 3) is hit.
  - All chat-participant flows (`/plan`, `/code`, `/execute`, full
    pipeline, and the new `/review-branch`) end with a structured
    summary card: outcome banner (`✅ Approved` or
    `⚠️ Did not converge`), total iterations across stages, elapsed
    time, severity counts of any remaining issues, and the final
    artifact rendered in full inside a `<details>` block. Replaces the
    bare `Done. approved=<bool>` line.
  - Live agent-status streaming: per-iteration headers,
    `stream.progress(...)` indicators while worker/reviewer calls are
    in flight, severity-grouped issue rendering (🔴/🟡/🔵), and
    truncated worker artifacts shown as they arrive instead of batched
    at stage end.

- **`chat-loop`** (extended)
  - `ChatClient` gains a `sendText(messages): Promise<string>` method
    on both `VscodeLmClient` and `GithubModelsClient`. It returns raw
    response text with no JSON parsing and no schema-retry path.
    Workers producing rich Markdown (e.g. fix proposals containing
    code blocks) use this path instead of `sendStructured`, eliminating
    the `WorkerOutput` envelope failures observed on large diffs.
  - New helpers in `src/agents.ts`: `loadPromptByName(name)` and
    `buildWorkerWithPrompt(system, client)`. They let callers build
    workers outside the Stage pipeline with arbitrary system prompts
    and the plain-text path. `Worker.produce()` is unchanged
    structurally — it still returns `string`. Reviewers continue to
    use `sendStructured` because verdict schema validation is the
    whole point of the cross-check.
  - New prompt file `src/prompts/review_branch_fixer.md` describing
    the fix-proposal output format (one section per reviewer finding,
    each with a code change and justification) and forbidding
    planning meta-work, JSON envelopes, and apologies.
  - Default `codecrosscheck.reviewerModel` changes from
    `anthropic/claude-opus-4.6` to `openai/gpt-5.4` to match the
    `--reviewer-model` CLI default.

## Impact

- Affected specs: `vscode-extension`, `chat-loop`.
- Affected code:
  - `src/extension.ts` — new `handleReviewBranch`, summary card,
    severity helpers, live event rendering.
  - `src/clients/ChatClient.ts`, `src/clients/vscodeLm.ts`,
    `src/clients/githubModels.ts` — `sendText` method.
  - `src/agents.ts` — `loadPromptByName`, `buildWorkerWithPrompt`.
  - `src/prompts/review_branch_fixer.md` — new prompt.
  - `src/loop.ts`, `src/pipeline.ts` — live callbacks, expanded
    `PipelineEvent` union, post-stage batching removed.
  - `package.json` — `codecrosscheck.reviewerModel` default.
- Behavioral change: previously `/review-branch` always ran PLAN
  semantics. Anyone scripting against the old behavior will see a
  reviewer-first dialogue instead. Output structure (transcript JSONL
  events) gains new event types
  (`review-branch-iter`, `review-branch-done`); existing
  `stage-start` / `stage-end` events continue to fire for the other
  slash commands.
- No new external dependencies. No new commands. No security-sensitive
  surface added.
