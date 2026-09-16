# Report applied edits as unsaved, not as written

## Why

`/apply-review` reports `✅ applied` for every successful edit and closes with
"Applied **N** edit(s); skipped **M**. Undo reverts the whole batch." A user
reading that has every reason to believe the files changed.

They have not. Edits are committed through `vscode.workspace.applyEdit`, which
mutates the editor's document model and leaves each touched document **dirty**.
Nothing reaches disk until the user saves. This is deliberate — the archived
requirement "Applied edits SHALL be undoable and SHALL respect open editors"
chose it so a batch of model-authored changes lands as one undo entry — but the
reporting does not say so.

The cost is not hypothetical. During the 2026-09-16 dogfood session this
misled the author twice in one hour: `/apply-review` reported 12 edits applied,
`git status` in the target worktree showed a clean tree, and the natural
conclusion was that the apply path was broken. It was not. The second time, the
same confusion cost another round trip.

Worse than the confusion is the silent-loss path: a user who reads "applied",
closes the window without saving, and discards the batch. Nothing warns them,
and the `-apply.json` debug log records `"status": "applied"` too, so the
post-mortem agrees with the wrong story.

## What Changes

- **MODIFIED capability `vscode-extension`**: `/apply-review` SHALL state that
  successful edits are applied to editor buffers and are not on disk until
  saved, and SHALL offer the user a way to save them. The per-edit status and
  the debug log SHALL NOT describe an unsaved buffer with the same word used
  for a file written to disk.

The mechanism does not change: `applyEdit` still carries the batch so a single
undo reverts it. Only the reporting, and an explicit save affordance, change.

## Impact

- Affected specs: `vscode-extension`.
- Affected code: `src/extension.ts` (`renderApplyOutcomes`, the apply summary,
  the debug-log payload), `src/applyReview.ts` (`ApplyOutcome.status`).
- No change to `applyEdits`, path validation, dry-run, or the build gate.
