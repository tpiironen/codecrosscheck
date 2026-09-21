# Tasks: realign-distribution-to-reality

**Decision taken: local-only.** Option A in the proposal.

## 1. Settled

- [x] 1.1 Rewrite `scripts/release.mjs` to use `child_process.spawnSync` with
      argument arrays instead of `execSync` on an interpolated string.
      `scripts/publish-vsix.mjs` — which interpolated
      `process.env.CCC_UNIVERSAL_FEED` and `CCC_VSIX_PACKAGE` into a shell
      command — is deleted rather than rewritten, so its injection surface is
      gone with it. Pinned by "release scripts do not shell-interpret commands"
      in `test/hygiene.test.ts`.
- [x] 1.2 Remove the Azure Artifacts registry gate from `scripts/release.mjs`;
      keep the clean-tree, `main`-branch and package-name gates, and add a
      `private` gate plus a green `npm run verify`.
- [x] 1.3 Remove the universal-feed download path from `src/install.ts`,
      keeping the skill installer and the `codecrosscheck-install` bin name.
      No subcommand now prints the documented build-and-install procedure and
      exits 2 — verified by running `node dist/install.js`.
- [x] 1.4 Correct `openspec/project.md` "Audience & distribution".
- [x] 1.5 Correct `openspec/AGENTS.md`: the `distribution` routing row and the
      "Internal Azure Artifacts feeds only" bullet.
- [x] 1.6 Correct `README.md` and `docs/ARCHITECTURE.md`. While sweeping,
      found and fixed an unrelated stale security claim in the README: it
      credited the EXECUTE sandbox with `NO_PROXY=*` "when network denied".
      `src/sandbox.ts` says outright that this denies nothing and was removed.
      A false claim about a security boundary is the worst kind of stale doc.
- [x] 1.7 Check `test/bundle.test.ts` and `test/hygiene.test.ts` for assertions
      about the release scripts or the `publish:*` npm scripts. — neither
      referenced them; no test anywhere did.
- [x] 1.8 Add tests. **Reversed after review.** The first attempt pinned only
      static manifest invariants (`private: true`, no `publishConfig`, no
      `publish:*` script, no `execSync` in `scripts/`) and justified skipping
      runtime coverage on the grounds that the success path runs
      `npm run verify` and is "too slow for the suite". The reviewer rejected
      that and was right: a throwaway repo whose own `verify` script is a
      one-line `node -e` runs the real gate end to end in about two seconds.
      The gate is now exercised for real — dirty tree, wrong branch, missing
      `private`, renamed package, and a success path that proves `verify` was
      invoked via a marker file and that nothing is published. The installer's
      no-subcommand path is executed too. Red-proofed: breaking the `private`
      check, the `verify` call and the installer's exit code failed exactly
      those 3 of 16. The dirty-tree, wrong-branch and renamed-package guards
      were proved red separately, by neutralising each check in turn — they
      had passed in both earlier sabotage states and so were unproven.

## 2. The publication-target decision

- [x] 2.1 Record the decision in `openspec/project.md`. — local-only.
- [x] 2.2 Delete `scripts/publish-vsix.mjs` and the `publish:npm` /
      `publish:vsix` scripts; reduce `release.mjs` to a verification gate.
      Added `"private": true` and removed `publishConfig`: with `publish:npm`
      gone but `publishConfig.access` left at `public`, a stray `npm publish`
      would still have reached the public registry. Verified that `private`
      does not break `npx vsce package --no-dependencies`.
- [x] 2.3 No follow-up change needed: the delta specifies local-only directly,
      so nothing is left deferred.

## 3. Gates

- [x] 3.1 `npx openspec validate realign-distribution-to-reality --strict`
      — passes; 13/13 repo-wide.
- [x] 3.2 Lint, both typechecks, full suite, `npm run build` — all green,
      265 passed / 8 skipped.
- [x] 3.3 Exercised `node scripts/release.mjs` on the working tree: it reports
      the dirty tree and exits 1. The gate runs, which the previous script
      could never demonstrate.
- [ ] 3.4 On archive, confirm the live `distribution` spec gained "Source
      hosting" and lost "Internal-only hosting" and "Two-feed split", and that
      "Manual release script" has 4 scenarios and "Consumer install path" has 3.
