# Tasks

## A. Derive the scope

- [x] A1 Add `patchPaths(patch)` to `src/openspec/diff.ts`, returning the
      post-image path of every per-file block in patch order.
- [x] A2 Share the header parsing with `filterPatchToScope` rather than
      duplicating the regex.

## B. State it in the prompts

- [x] B1 Add `buildScopeBlock(paths)` naming the changed files and the rule that
      every finding must cite one.
- [x] B2 Cap the listed paths and report the remainder as a count.
- [x] B3 Thread the block into the reviewer, triager and fixer inputs, including
      the re-review pass.

## C. Verification

- [x] C1 Cover `patchPaths` including renames and a patch with no blocks.
- [ ] C2 Run `@codecrosscheck /review-branch` on this branch (repo policy for
      any change under `src/`).
