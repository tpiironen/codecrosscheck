# Tasks: flush-transcript-before-return

- [x] 1.1 Add `flush(): Promise<void>` to the `Transcript` interface.
- [x] 1.2 In `openTranscript`, retain the first append error instead of
      discarding it, and have `flush()` await the queue and report it.
- [x] 1.3 Await `flush()` before returning from `/review-branch`,
      `/openspec-review` and the pipeline handler, after their terminal events.
- [x] 1.4 Warn in chat when `flush()` reports a failure, without failing the
      run. — `flushTranscript` helper.
- [x] 1.5 Extract the transcript writer so it is testable without `vscode`, or
      test it through an injected filesystem. — new `src/transcript.ts`.
- [x] 1.6 Add tests: every queued event is on disk after `flush()`; a reader
      before `flush()` may see less; an append failure is reported by `flush()`
      rather than swallowed. — 6 tests in `test/transcript.test.ts`.
- [x] 1.7 Red-proof: remove the `await flush()` and confirm a test fails.
      — 5 of 6 fail.
- [x] 1.8 Run lint, typecheck, the full suite, and
      `npx openspec validate flush-transcript-before-return --strict`.
      — all green, 164 passed / 8 skipped.
