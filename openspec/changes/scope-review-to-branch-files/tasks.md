# Tasks

## A. Derive the scope

- [x] A1 Add `patchPaths(patch)` to `src/openspec/diff.ts`, returning the
      post-image path of every per-file block in patch order.
- [x] A2 Share the header parsing with `filterPatchToScope` rather than
      duplicating the regex.
- [x] A3 Harden `blockPath`: read the `+++`, `---` and `rename to` markers
      before the `diff --git` header, and decode git's C-quoting, so a path
      containing a space or a non-ASCII byte is not dropped from the scope.

## B. State it in the prompts

- [x] B1 Add `buildScopeBlock(paths)` naming the changed files and the rule that
      every finding must cite one.
- [x] B2 Cap the listed paths and report the remainder as a count.
- [x] B3 Thread the block into the reviewer, triager and fixer inputs, including
      the re-review pass.

## C. Verification

- [x] C1 Cover `patchPaths` including renames and a patch with no blocks.
- [x] C2 Run `@codecrosscheck /review-branch` on this branch (repo policy for
      any change under `src/`). Run 2026-09-21 against the installed
      `0.5.1-rc.1` build, verified to carry this branch's `buildScopeBlock`, so
      the run exercised the scope block it was reviewing. Findings applied:
      `blockPath` now reads marker lines and decodes git's C-quoting, and
      `test/extensionScope.test.ts` asserts the scope reaches all four prompts.
