# Add loop cancellation and review the working tree

## Why

**1. Stopping a review does not stop the models.**
The chat handler discards its `CancellationToken` (`void token;`), and
`VscodeLmClient.sendRaw` manufactures a fresh
`new vscode.CancellationTokenSource().token` that is never cancelled and never
disposed. Pressing stop in the Chat view abandons the UI while the loop keeps
running — up to `maxIters` rounds of worker and reviewer calls, each of which
can carry a 200 KB diff. The user has no way to halt a run they know is
misdirected, and quota is consumed either way.

**2. `/review-branch` does not review what the user is looking at.**
`getChangeDiff` runs `git diff <base>...HEAD`, which compares two commits.
Working-tree and staged changes are invisible to it. The repository's own
`.github/copilot-instructions.md` nevertheless instructs contributors to
"invoke `@codecrosscheck /review-branch` **on the working tree**" before
committing — so the documented dogfooding workflow reviews the previous commit
while the author believes their uncommitted edits were checked. A review that
silently examines the wrong revision is worse than no review.

Separately, `base` is already resolved to a merge-base commit before the range
is built, which makes the three-dot in `${base}...HEAD` a redundant second
merge-base computation.

## What Changes

- **MODIFIED capability `chat-loop`**: `ChatClient` implementations SHALL
  accept an abort signal, propagate it to the underlying transport, and stop
  issuing requests once it is aborted. `reviewLoop` and `runPipeline` SHALL
  check the signal between iterations and stages and return the work completed
  so far rather than throwing.
- **MODIFIED capability `vscode-extension`**: every chat handler SHALL pass the
  request's `CancellationToken` into the loop, and SHALL report a cancelled run
  distinctly from an approved or exhausted one.
- **MODIFIED capability `openspec-integration`**: the diff slicer SHALL include
  uncommitted work by default, covering staged and unstaged tracked changes,
  and SHALL state in its output header which revision range it compared.

## Impact

- Affected specs: `chat-loop`, `vscode-extension`, `openspec-integration`.
- Affected code: `src/clients/ChatClient.ts`, `src/clients/vscodeLm.ts`,
  `src/clients/githubModels.ts`, `src/loop.ts`, `src/pipeline.ts`,
  `src/openspec/diff.ts`, `src/extension.ts`, `src/cli.ts`.
- Affected tests: `test/loop.test.ts`, `test/openspec.diff.test.ts`, new
  cancellation cases.
- User-visible change: stop actually stops; `/review-branch` reviews
  uncommitted work and names the compared range in its header.
