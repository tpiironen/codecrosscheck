# Change: budget-file-context-per-file

## Why

The repository file context block is capped at 60 000 characters and the cap is
applied as a blunt prefix slice: `inventory.slice(0, fileContextCap)`. Files are
concatenated in harvest order, so the cut lands wherever 60 000 characters fall.

Measured on a live `/review-branch` run against the `C:\src\AI-review` worktree
on 2026-09-15 (transcript `2026-09-15T12-19-06-304Z.jsonl`):

- `src/extension.ts` is **63 430 chars** — it exceeds the entire budget on its
  own, so it was cut mid-function.
- `src/applyReview.ts` (29 414 chars) was cited by the second finding and
  **never entered the block at all**.

The triager returned `uncertain` for both findings and said exactly why: "the
provided file is truncated mid-function" and "the body of `applyEdits` ... was
not provided". Both statements are verifiable against the file sizes. Outcome
was `defended`, nothing was fixed, and a model call was spent reaching a
non-answer.

Triage behaved correctly — it refused to confirm findings it could not verify
rather than adjudicating on plausibility. But a step that can never see enough
code will always abstain, which makes `add-finding-triage` inert in exactly the
situation it was built for: a large file with a contested claim inside it.

One `fileContextBlock` feeds both the triager and the fixer, so the fixer is
starved by the same mechanism.

## What Changes

- The budget is allocated **per cited file** instead of as one prefix cut. Every
  cited file receives a share, so no file is silently dropped.
- Small files are included whole; the unused remainder of their share is
  redistributed to larger files, so the budget is not wasted on padding.
- A file that still does not fit is truncated **individually and labelled**, so
  the model knows precisely which file is partial rather than inferring it from
  a single note at the end of the block.
- Truncation keeps the head and the tail of the file with a marked elision in
  between, because a finding may cite a symbol anywhere in the file and the
  current head-only cut systematically hides the end.

## Impact

- Affected specs: `vscode-extension` — "review-branch repository file context".
- Affected code: `src/applyReview.ts` (`buildFileInventory`), `src/extension.ts`
  (the call site that currently slices).
- No change to which paths are harvested, nor to the 60 000-character total.
- Behavioural: findings citing a second or third file become adjudicable, so
  triage can return `confirmed` / `rejected` where it previously had to abstain.

## Open questions

- Whether the triager should receive a larger budget than the fixer. Not changed
  here: the failure observed was total omission, not a marginal shortfall, and
  splitting the budgets is a separate decision with its own token cost.
