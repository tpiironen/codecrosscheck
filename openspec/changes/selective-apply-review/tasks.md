# Tasks: selective-apply-review

## 1. Selection model

- [ ] 1.1 Add a pure selection filter to `src/applyReview.ts` that takes a
      `FixProposal` and a set of finding ids and returns the `ApplyEdit[]` for
      those findings only. Keep it free of `vscode` imports so it is testable
      under vitest.
- [ ] 1.2 Add a directive parser for `only <ids>` / `skip <ids>` alongside the
      existing `force-fix-all` handling, returning the resolved id set plus any
      ids that matched no finding.
- [ ] 1.3 Decide and record what happens when both directives are present in
      one prompt. Do not leave it to precedence in the parser.

## 2. Extension wiring

- [ ] 2.1 In `handleApplyReview`, build the eligible list from fixes with
      status `fixed` and present a multi-select QuickPick with every entry
      pre-selected. Follow the `codecrosscheck.pickModels` command for the
      existing QuickPick conventions.
- [ ] 2.2 Skip the picker when a directive is present.
- [ ] 2.3 Treat dismissal as cancelled: write nothing, and return the
      `cancelled` outcome rather than a failure.
- [ ] 2.4 Report unknown directive ids to the user before applying anything.
- [ ] 2.5 Extend the `*-apply.json` log with the selected and declined finding
      ids.
- [ ] 2.6 Confirm dry-run previews exactly the selected edits.

## 3. Tests

- [ ] 3.1 Selection filter: subset selected, empty selection, all selected,
      a fix whose status is not `fixed` is never eligible.
- [ ] 3.2 Directive parser: `only`, `skip`, whitespace and casing variants,
      unknown id reported, and the both-directives case decided in 1.3.
- [ ] 3.3 An end-to-end apply test asserting that a declined finding's file is
      untouched. Use the existing `FsLike` fake rather than the real
      filesystem.
- [ ] 3.4 Red-proof: replace the filter with the identity and confirm the
      subset tests fail, and only those.

## 4. Gates

- [ ] 4.1 `npx openspec validate selective-apply-review --strict`.
- [ ] 4.2 Lint, both typechecks, full suite, `npm run build`.
- [ ] 4.3 Dogfood: `@codecrosscheck /review-branch` on this change's own branch.
- [ ] 4.4 Manual check in the Run and Debug host ("Run Extension on AI-review
      worktree"): the picker appears, deselecting one finding leaves its file
      untouched, and dismissing writes nothing. The QuickPick path cannot be
      covered by vitest.
- [ ] 4.5 Update `README.md` and the `/apply-review` help text with the
      directive syntax.
