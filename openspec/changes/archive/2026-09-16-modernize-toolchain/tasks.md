# Tasks

## A. Type-checking and lint
- [x] A1. Add `tsconfig.test.json` extending the base config and including
       `test/**/*.ts` with `noEmit`.
- [x] A2. Add a `typecheck` script running both configs with `--noEmit`.
- [x] A3. Add ESLint with `typescript-eslint`, covering `src/` and `test/`, and
       a `lint` script.
- [x] A4. Fix or remove every violation, including the orphan
       `no-explicit-any` directive in `src/clients/vscodeLm.ts`.

## B. Strictness
- [x] B1. Enable `noUncheckedIndexedAccess`, `noUnusedLocals`,
       `noUnusedParameters`, `noImplicitOverride`,
       `noFallthroughCasesInSwitch`.
- [x] B2. Delete `void token;`, `void dryRun;`, `void context;`, `void z;` and
       the symbols they were suppressing.
- [x] B3. Fix the unchecked index accesses the new flags report, principally in
       the regex parsers in `src/applyReview.ts`.
- [x] B4. Remove the dead `HERE` statement and the `__dirname` / `import.meta`
       mix in `test/corpus.test.ts`.
- [x] B5. Add `test/hygiene.test.ts` asserting no `void <identifier>;`
       statements and no orphan `eslint-disable` directives remain.

## C. Dependencies
- [x] C1. Upgrade `zod` to v4 and replace `zodToJsonSchema` with
       `z.toJSONSchema`; drop the `zod-to-json-schema` dependency.
- [x] C2. Replace `undici` with global `fetch` in `src/clients/githubModels.ts`;
       drop the dependency and `closeUndici()` from `src/cli.ts`.
- [x] C3. Upgrade `vitest`, validate, and fix fallout.
- [x] C4. Upgrade `typescript`, validate, and fix fallout.
       **Deferred to `^5.9.3`** — `typescript-eslint` does not support TS 7.0.
       See the "Deferred: TypeScript 7" section in `proposal.md`. The
       `"types": ["node"]` config change TS 7 required is kept, so the upgrade
       is a one-line change once the linter catches up.
- [x] C5. Upgrade `commander`, `@types/node`, `@types/vscode`, `esbuild`,
       `@vscode/vsce`.
- [x] C6. Record in the proposal any upgrade that could not be landed cleanly,
       with the reason.
- [x] C7. Update the bundle self-containment test's external list for the
       removed dependencies.

## D. CI
- [x] D1. Add `lint` and `typecheck` steps to the build-test job.
- [x] D2. Add a `vsce package` step.
- [x] D3. Add a separate corpus job on `workflow_dispatch` and a schedule,
       gated on a model token secret.
- [x] D4. Report the corpus skip reason in test output.

## E. Docs
- [x] E1. CHANGELOG entry for the dependency removals.
- [x] E2. `openspec/project.md`: update the runtime-dependency list.
- [x] E3. `CONTRIBUTING.md`: document the new lint and typecheck gates.
