# Tasks: correct-vscode-extension-spec-drift

- [ ] 1.1 Count the scenarios in each of the three requirements in the live
      spec before and after archiving. `## MODIFIED` replaces the whole block,
      and `validate --strict` will not catch a dropped scenario.
      — before: settings 1, re-review scoping 4, triage 4.
- [ ] 1.2 Confirm no source change is needed: `codecrosscheck.execute.allowNetwork`
      is absent from `package.json`, `harvestPathsFromText` is absent from
      `src/`, and `buildTriageInput` takes no file context.
- [ ] 1.3 Run `npx openspec validate correct-vscode-extension-spec-drift --strict`.
- [ ] 1.4 Run lint, both typechecks and the full suite to confirm the
      documentation change leaves the gates green.
- [ ] 1.5 On archive, re-count the scenarios in the live spec and confirm
      1 / 4 / 4 survived.
