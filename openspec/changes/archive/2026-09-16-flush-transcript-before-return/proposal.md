# Change: flush-transcript-before-return

## Why

`/review-branch` and `/openspec-review` queue transcript writes behind a
promise chain and return without waiting for it. `/apply-review` then reads the
newest transcript and requires a terminal `review-branch-done` event.

Nothing guarantees that event is on disk when the handler returns. A standalone
reproduction of the exact queue pattern shows a reader running immediately
after the handler returns sees an **empty file** — so `/apply-review` triggered
promptly, including via the "Apply this fix proposal" button the review itself
renders, can fail with "no transcript found" for a review that in fact
succeeded.

The failure is also invisible. Every append is wrapped in
`.catch(() => undefined)`, so an I/O error silently drops an event and leaves
no trace anywhere. While investigating this, a missing `review-branch-start`
event was initially misdiagnosed as this bug; it turned out to be a stale
extension. A dropped write and a stale build were indistinguishable, which is
itself the problem.

## What Changes

- `Transcript` gains `flush(): Promise<void>`, resolving when every queued
  append has been written.
- The three handlers that write a terminal event await `flush()` before
  returning.
- Append failures are retained rather than discarded. `flush()` reports the
  first one, and the handler warns in chat that the transcript is incomplete.
- A transcript failure SHALL NOT fail an otherwise successful review. The run's
  verdict is the valuable output; the transcript is a record of it.

## Impact

- Affected specs: `vscode-extension` (new requirement).
- Affected code: `src/extension.ts` (`openTranscript`, the `Transcript`
  interface, and the three terminal-event call sites).
- Fixes a real race that makes the documented
  `/review-branch` → `/apply-review` workflow intermittently fail.
- `write()` stays synchronous and non-blocking, so no caller changes shape.
- Found by the tool reviewing its own branch — the only finding of two that
  survived verification.
