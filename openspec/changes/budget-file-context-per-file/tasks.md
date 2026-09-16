# Tasks: budget-file-context-per-file

- [x] 1.1 Add a budget option to `buildFileInventory` that allocates the total
      across cited files rather than concatenating and slicing.
- [x] 1.2 Give small files their full contents and redistribute their unused
      share to the files that need it.
- [x] 1.3 Truncate an oversized file individually, keeping head and tail with a
      marked elision, and label the file as partial in its own header.
- [x] 1.4 Replace the `inventory.slice(0, fileContextCap)` call site in
      `src/extension.ts` with the budgeted call.
- [x] 1.5 Tests: no cited file is dropped when the total is exceeded; a small
      file is included whole; an oversized file is labelled partial and retains
      head and tail; the total stays within budget; behaviour is unchanged when
      everything fits. (6 new cases, `test/applyReview.test.ts`; suite 191 → 197.)
- [x] 1.6 Red-proof at least one test against the old prefix-slice behaviour.
      Greedy in-order allocation fails 3 of 64, including "keeps every cited file
      when the first one alone exceeds the budget".
- [x] 1.7 Run lint, typecheck, the full suite, build, and
      `npx openspec validate budget-file-context-per-file --strict`.
- [x] 1.8 Re-run `/review-branch diff-base=8ff6180` in the worktree.
      Run 2026-09-16 (`2026-09-16T07-38-59-138Z.jsonl`): the budgeting works — the
      triager read late-file code and referred to "the elided middle section",
      confirming head+tail retention and the `PARTIAL` label. **But the run still
      ended `defended` with `uncertain`.** The single finding cited only
      `src/extension.ts`, so `src/applyReview.ts` was never harvested and no
      budgeting could have included it. That is a separate defect — context is
      scraped lexically from finding text and the triager cannot request a file
      it discovers it needs. Tracked by `replace-context-harvest-with-tools`.
      **This change does not make triage able to adjudicate; it only stops a
      cited file being starved out by a larger one.**
