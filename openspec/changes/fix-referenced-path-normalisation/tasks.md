# Tasks: fix-referenced-path-normalisation

- [x] 1.1 Strip a trailing `:symbol` suffix in `normalizeReferencedPath`,
      alongside the existing `:line` handling.
- [x] 1.2 In `buildFileInventory`, treat a path that still contains `:` after
      normalisation as unresolvable and add it to `missing`, rather than
      describing it to the worker as a file to create.
- [x] 1.3 Report in chat when the inventory yielded no file content, so an
      empty edit set is attributed rather than silent.
- [x] 1.4 Tests: symbol suffix stripped; line suffix still stripped; a path
      containing `:` is reported missing and produces no creation note; a
      legitimate new-file reference still produces one.
- [x] 1.5 Red-proof at least one test. — both halves proved separately:
      disabling the symbol strip fails the normalisation test; disabling the
      unresolvable-path guard fails the inventory test.
- [x] 1.6 Run lint, typecheck, the full suite, build, and
      `npx openspec validate fix-referenced-path-normalisation --strict`.
      — all green, 190 passed / 8 skipped.
- [x] 1.7 Re-run `/apply-review` in the worktree and confirm edits are derived,
      then complete manual task A7. — 6 edits derived and applied where the
      previous run produced 0; A7 verified and ticked.
- [x] 1.8 Correction (2026-09-15): the first regex could not match a symbol
      written with call syntax — `src/extension.ts:workspaceEditHost().commit`,
      which is the shape actually present in the 2026-09-14 transcript's verdict
      `where` field. The original test asserted on an invented bare-symbol
      string and so passed regardless. Character class widened to admit
      parentheses; the test now uses the verbatim reference; red-proofed at
      1 of 58 failing when reverted. Suite 191 passed / 8 skipped.
