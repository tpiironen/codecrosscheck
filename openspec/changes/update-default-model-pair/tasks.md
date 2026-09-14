# Tasks: update-default-model-pair

- [ ] 1.1 Update `codecrosscheck.workerModel` and `codecrosscheck.reviewerModel`
      defaults in `package.json`, including the example family in the worker
      setting's description.
- [ ] 1.2 Update `DEFAULTS.workerModel` and `DEFAULTS.reviewerModel` in
      `src/config.ts` to the same values.
- [ ] 1.3 Change the `--reviewer-model` default in `src/cli.ts` so it no longer
      matches `--worker-model`, and update `--worker-model` to the new family.
- [ ] 1.4 Update the model pair in `README.md` (settings table and CLI flag
      table), `docs/ARCHITECTURE.md`, `openspec/project.md`,
      `.github/skills/codecrosscheck-delegate/SKILL.md` and the fallback in
      `test/corpus.test.ts`.
- [ ] 1.5 Add a CHANGELOG entry under `[Unreleased]` recording the new pair and
      the CLI same-model fix.
- [ ] 1.6 Run `npx vitest run test/config.test.ts` and confirm the
      manifest/DEFAULTS parity assertion and the
      "reviewer default differs from worker default" assertion both pass.
- [ ] 1.7 Run `npx openspec validate update-default-model-pair --strict`.
- [ ] 1.8 **Manual:** run **CodeCrossCheck: Pick Worker and Reviewer Models** in
      an Extension Development Host and confirm both new family strings resolve
      to a real model. Until this is done the defaults are unverified.
