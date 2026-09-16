# rename-openspec-implement-to-review

## Why

The `/openspec-implement` slash command is misleadingly named. It does not
implement anything on disk — it only runs a worker↔reviewer dialogue with
the OpenSpec change frame injected and the validator pre-gate enabled. The
result lives in chat memory and disappears at end of turn. No files are
written, no transcript is produced that `/apply-review` can consume.

Users (including the author) repeatedly assume the command writes code and
are surprised when nothing changes on disk. The fix is to:

1. Rename to `/openspec-review` — accurate description of what it does.
2. Write the worker's CODE-stage artifact into a `.codecrosscheck/runs/<iso>.jsonl`
   transcript in the same `review-branch-iter` / `review-branch-done` format
   that `/apply-review` already consumes for `/review-branch`.
3. Default the stage list to `plan, code` (drop `execute` — the sandbox can
   never reproduce a real workspace, so its verdict is misleading).
4. Stream proposal summary as the first chat message (spec already requires
   this; current handler omits it).
5. Stream every iteration verdict, not only `stage-end` (current handler
   produces minutes of silence followed by one terse line).
6. Wrap the handler in `try/catch` and surface `loadChange` errors to the
   user instead of swallowing them.
7. Keep `/openspec-implement` registered as a deprecated alias that prints
   a one-line deprecation notice and forwards to the new handler. Avoids
   breaking anyone who memorised the old name.

The two-step workflow then mirrors `/review-branch` + `/apply-review`:

```
/openspec-review <change-id>   → draft + transcript
/apply-review                  → write files + build gate
```

## What Changes

- `vscode-extension` — register `/openspec-review`; keep `/openspec-implement`
  as deprecated alias; new handler streams proposal, per-iteration progress,
  and writes a transcript readable by `/apply-review`.
- `openspec-integration` — replace the `Implement command runs full pipeline`
  scenario with one that reflects actual behaviour (draft + transcript, no
  EXECUTE stage by default, transcript is consumable by `/apply-review`).

## Impact

- `src/extension.ts` — refactor of the openspec command handler.
- `openspec/changes/add-codecrosscheck/specs/openspec-integration/spec.md`
  — replace one scenario, add one scenario.
- `README.md` — update the slash command table and add a two-step workflow
  example.
- `test/openspec-review.test.ts` (new) — verifies transcript file is written
  in the `review-branch-iter`/`review-branch-done` format, contains the CODE
  artifact, and is discoverable by `findLatestTranscript`.

No CLI behaviour changes — `--openspec <id>` keeps its existing semantics.
