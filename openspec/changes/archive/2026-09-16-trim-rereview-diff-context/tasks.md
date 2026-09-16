# Tasks: trim-rereview-diff-context

- [x] 1.1 Export a helper that counts the files in a unified-diff patch, or
      reuse an existing one, so the omitted-file count can be reported.
      — `countPatchFiles` in `src/openspec/diff.ts`.
- [x] 1.2 At the re-review call site in `handleReviewBranch`, build the scoped
      patch from the already-harvested cited paths using `filterPatchToScope`.
      — via new `scopePatchToPaths`, reusing the existing `harvested` set.
- [x] 1.3 Fall back to the full diff when the scoped patch is empty.
- [x] 1.4 Extend `buildRereviewInput` to take the scoped body plus the omitted
      file count, and to state in the prompt that the diff is scoped.
- [x] 1.5 Record the scoping decision in the `review-branch-iter` transcript
      event (chars sent, files included, files omitted) so the saving is
      measurable from a transcript rather than asserted.
- [x] 1.6 Add tests: scoped when findings cite a subset; full diff when nothing
      matches; omitted count correct; first pass unaffected.
      — 6 tests in `test/openspec.diff.test.ts`.
- [x] 1.7 Red-proof at least one test by reverting the scoping and confirming
      it fails. — replacing the filter with the identity fails exactly 3 of 12.
- [x] 1.8 Run lint, typecheck, the full suite, and
      `npx openspec validate trim-rereview-diff-context --strict`.
      — all green, 158 passed / 8 skipped.
