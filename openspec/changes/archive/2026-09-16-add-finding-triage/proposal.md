# Change: add-finding-triage

## Why

`/review-branch` asks the worker to *draft fixes* for the reviewer's findings.
Asked to fix, the worker fixes. Nothing in the loop asks the prior question:
**is this finding real?**

This is not theoretical. In the run recorded at
`.codecrosscheck/runs/2026-09-14T12-25-09-360Z.jsonl`, the reviewer raised two
findings. One was false: it claimed
`WorkspaceEdit.createFile(uri, { contents })` does not accept a `contents`
payload. It does — `readonly contents?: Uint8Array | DataTransferFile` is
declared in the VS Code typings and documented as "The initial contents of the
new file".

The worker did not challenge it. It restated the false premise, rewrote
`workspaceEditHost().commit` into a longer version with an extra
`workspace.fs.stat` call per file, and added the comment "`createFile` only
creates the file; the content must be a separate text edit". The reviewer then
approved that proposal. Applying it would have replaced working code with more
complex code and recorded a false claim about the API in a comment.

The existing rebuttal path (`parseDisagreements`) is a side-channel: the worker
must volunteer disagreement while under instruction to produce fixes, and the
result is recovered by parsing prose headings. The repository already tests
reviewers for sycophancy (`test/corpus/code/sycophantic-approval`) while
structurally inducing it in the worker.

## What Changes

- A new **triage** stage runs after the reviewer's findings and before any fix
  drafting. The worker is asked, per finding, whether the finding is real,
  and answers with a zod-validated structured verdict rather than prose.
- Triage statuses are `confirmed`, `rejected` and `uncertain`. `uncertain`
  exists so the model is never forced to guess; a guess would otherwise become
  an edit.
- Every triage entry SHALL carry evidence, in both directions. A rejection must
  cite the code, type declaration, test or documentation that settles it.
- Only `confirmed` findings are passed to the fix-drafting step. `rejected` and
  `uncertain` findings are reported to the user and excluded.
- Triage results are recorded in the transcript so `/apply-review` and any
  later selective-apply step can consume them.
- When every finding is rejected, the run reports that the code was defended,
  which is a different and more useful outcome than "the reviewer approved a
  proposal".

## Impact

- Affected specs: `chat-loop` (new triage schema and agent),
  `vscode-extension` (new stage in the `/review-branch` dialogue).
- Affected code: `src/schemas.ts`, `src/agents.ts`, a new triage prompt,
  `src/extension.ts`.
- Adds one model call per iteration that has findings. That call is small — it
  carries the findings and the cited files, not the whole diff — and it removes
  fix-drafting work for findings that should never have been drafted.
- Behavioural change: findings the worker rejects no longer produce fix text.
  Users who want the old behaviour keep it with the existing `force-fix-all`
  directive, which SHALL bypass triage.
- The existing `issueFingerprint` / rejection-memory machinery is reused so a
  rejection can persist across re-runs.
