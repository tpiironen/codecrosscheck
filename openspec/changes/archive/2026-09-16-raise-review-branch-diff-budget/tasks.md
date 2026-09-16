# Tasks: raise-review-branch-diff-budget

- [x] 1.1 Change the `codecrosscheck.reviewBranch.maxDiffChars` default to
      `1100000` in `package.json`.
- [x] 1.2 Change `DEFAULTS["reviewBranch.maxDiffChars"]` to `1_100_000` in
      `src/config.ts`.
- [x] 1.3 Update the documented default in `README.md`,
      `docs/ARCHITECTURE.md` and
      `.github/skills/codecrosscheck-delegate/SKILL.md`.
- [x] 1.4 Add a CHANGELOG entry under `[Unreleased]`.
- [x] 1.5 Run `npx vitest run test/config.test.ts` and confirm the
      manifest/`DEFAULTS` parity assertion passes. — red-proofed: setting
      `DEFAULTS` out of step with the manifest fails exactly that assertion.
- [x] 1.6 Run `npx openspec validate raise-review-branch-diff-budget --strict`.
