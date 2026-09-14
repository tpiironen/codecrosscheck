# Modernize the toolchain and dependencies

## Why

The repository's quality gates have holes that let real defects through, and
its dependencies have drifted a major version or more behind.

**Test sources are never type-checked.** `tsconfig.json` excludes `test`, and
vitest transpiles without checking types, so no test file is type-checked by
any gate. The evidence is in the tree: `test/corpus.test.ts` contains a bare
`HERE` expression statement — dead code nothing flagged — and the same file
mixes `fileURLToPath(import.meta.url)` with `__dirname`.

**There is no linter.** `src/clients/vscodeLm.ts` carries an
`// eslint-disable-next-line @typescript-eslint/no-explicit-any` directive for
an ESLint that is not installed or configured. Four `void x;` statements
(`void token`, `void dryRun`, `void context`, `void z`) exist purely to
suppress unused-symbol warnings from compiler flags that are switched off — so
the code carries the cost of the rule without the benefit. One of them,
`void token`, is how the discarded cancellation token got past review.

**Strictness is partial.** `strict` is on, but `noUncheckedIndexedAccess`,
`noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` and
`noFallthroughCasesInSwitch` are not. The regex-heavy parsers in
`src/applyReview.ts` index match groups unguarded throughout.

**CI under-tests.** The workflow builds and runs vitest on two operating
systems, but never lints, never type-checks tests, and never packages a VSIX —
even though the regression `test/bundle.test.ts` exists to catch is a
*packaging* failure that shipped in 0.2.0.

**The reviewer corpus never runs.** `test/corpus.test.ts` is
`describe.skipIf(!RUN)` and `RUN_LIVE_TESTS` is set nowhere, so all eight
planted-flaw cases are skipped in every local and CI run. The only gate on
prompt behaviour is inert, and prompt regressions are uncaught.

**Dependencies are behind.** Measured against the registry: `zod` 3.25 vs 4.6,
`undici` 6.25 vs 8.10, `vitest` 2.1 vs 5.0, `typescript` 5.9 vs 7.0,
`commander` 12.1 vs 15.0, `@types/node` 20 vs 22. Two of these enable
deletions rather than upgrades: zod 4 has a native `z.toJSONSchema()`, which
removes the `zod-to-json-schema` dependency entirely; and Node 20's global
`fetch` removes `undici`, which in turn removes the `closeUndici()` libuv
shutdown workaround in the CLI.

## What Changes

- **MODIFIED capability `verification`**: test sources SHALL be type-checked by
  a gate that runs in CI, and the project SHALL enforce a lint configuration
  rather than carrying directives for an absent linter.
- **MODIFIED capability `verification`**: compiler strictness SHALL be raised,
  and the `void x;` suppression idiom SHALL be removed rather than preserved.
- **MODIFIED capability `verification`**: CI SHALL lint, type-check, test, and
  package a VSIX.
- **MODIFIED capability `verification`**: the planted-flaw corpus SHALL be
  runnable as a scheduled or manually dispatched job with credentials, and its
  skip condition SHALL be visible rather than silent.
- **MODIFIED capability `chat-loop`**: JSON Schema generation SHALL come from
  zod itself, and HTTP SHALL use the platform `fetch`. The
  `zod-to-json-schema` and `undici` dependencies SHALL be removed.

## Impact

- Affected specs: `verification`, `chat-loop`.
- Affected code: `tsconfig.json`, new `tsconfig.test.json`, new ESLint config,
  `package.json`, `.github/workflows/ci.yml`, `src/clients/githubModels.ts`,
  `src/cli.ts`, `test/corpus.test.ts`, plus mechanical fixes wherever raised
  strictness reports a real unchecked access.
- Affected tests: all, via the new gates.
- User-visible change: none at runtime. The published package loses two
  transitive dependency trees.
- **Risk**: major upgrades of `typescript`, `vitest`, `zod` and `commander` can
  surface incompatibilities. Each is upgraded and validated independently; any
  that cannot be landed cleanly is recorded here rather than forced.

## Deferred: TypeScript 7

`typescript@7.0.2` was installed and **reverted**. It compiles the project
cleanly once `"types": ["node"]` is added to `tsconfig.json` (TS 7 does not
auto-include `@types/*` the way TS 5 did — that config change is kept). But
`typescript-eslint` refuses to load against it:

> typescript-eslint does not support TS 7.0. … See
> <https://github.com/typescript-eslint/typescript-eslint/issues/10940> for
> tracking typescript-eslint's support for TS >=7.1

The lint gate is a permanent quality control; the TS 7 compiler is a
performance upgrade. Trading a working linter for a faster compiler is the
wrong trade, and the side-by-side TS 6 workaround adds a second compiler to the
tree purely to satisfy a lint tool. `typescript` therefore stays on `^5.9.3`
until `typescript-eslint` supports TS >= 7.1.
