# Change: fix-referenced-path-normalisation

## Why

`/apply-review` silently produces zero edits whenever the fix proposal
annotates a path directive with a symbol name. Observed live on 2026-09-14
against the worktree at `C:\src\AI-review`: the command found the right
transcript and iteration, then reported "Worker returned zero edits. Nothing to
apply." The debug log shows why:

    referenced : src/extension.ts:workspaceEditHost,
                 src/extension.ts:Transcript,
                 src/extension.ts:openTranscript, …
    missing    : (empty)
    edits      : 0

Two defects combine.

**The path is not normalised.** `normalizeReferencedPath` strips backticks,
trailing parentheticals such as `(excerpt)`, and line-number suffixes such as
`:21` or `:21-30` — but not `:symbolName`. The worker had written
`// path: src/extension.ts:workspaceEditHost`, which is a natural thing to
write and which the fixer prompt does not forbid.

**The failure is then disguised as a benign state.** `buildFileInventory` finds
that `src/extension.ts:workspaceEditHost` does not exist and takes the
"does not exist yet — emit a creation edit" branch, intended for files the
proposal wants to create. So six malformed references became six invitations to
create phantom files, `missing` stayed empty, and the chat warning that exists
for unreadable paths never fired. The worker was never shown a single line of
the real file and correctly declined to invent edits.

The second defect is the more serious: an unresolvable reference was classified
as a legitimate creation target, so nothing anywhere reported a problem. This is
the same shape as the transcript writer's swallowed append errors fixed earlier
in this release — a failure rendered indistinguishable from success.

This also plausibly explains a user report that `/apply-review` is never used
in practice.

## What Changes

- `normalizeReferencedPath` strips a trailing `:symbol` suffix as well as a
  trailing `:line` suffix.
- A referenced path that still contains `:` after normalisation is treated as
  unresolvable and reported in `missing`, never as a file to create.
- When the inventory ends up containing no actual file content, the handler
  says so, so "zero edits" is explained rather than mysterious.

## Impact

- Affected specs: `vscode-extension` (the `/apply-review` requirement).
- Affected code: `src/applyReview.ts`, `src/extension.ts`.
- Fixes `/apply-review` for the common case of a symbol-annotated path
  directive. No change to the apply or safety rules themselves.
- Unblocks manual task A7 in `fix-edit-application-and-verdict-honesty`, which
  cannot be performed while `/apply-review` writes nothing.
