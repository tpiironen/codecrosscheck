# Change: realign-distribution-to-reality

> **Decision taken: local-only.** The project publishes to no registry. This
> was open when the proposal was drafted and is now settled; the branch point
> that follows is kept only to record what was weighed.

## Why

The `distribution` capability is the only one whose specification was never
updated when the thing it describes was replaced. Release 0.4.0 moved the
project from internal Azure DevOps to a public GitHub repository and changed
`package.json` accordingly, but it changed nothing else. Every other artifact
still describes Azure Artifacts.

Verified against the tree at `v0.5.1`:

| Claim in the spec / docs | Actual state |
| --- | --- |
| "hosted exclusively on Azure DevOps (Repos + Azure Artifacts)" | `repository.url` is `github.com/tpiironen/codecrosscheck`; CI is GitHub Actions; PRs #3–#6 are GitHub PRs |
| "SHALL NOT be published to public npm" | `publishConfig` is `{"access":"public"}`, `license` is MIT |
| Two feeds `codecrosscheck-npm` / `codecrosscheck-universal` | Neither exists; no `az` login is configured |
| `npm install -g @internal/codecrosscheck` | Package `name` is `codecrosscheck`; the `@internal` scope was dropped in 0.4.0 |
| "after a one-time `.npmrc` configuration" | `.npmrc.template` was deleted in 0.4.0 |
| `openspec/project.md`: "Repo: Azure DevOps Repos, project `codecrosscheck`" | False since 0.4.0 |
| `openspec/project.md`: "the `.npmrc.template` hooks remain in the tree" | It does not |
| `openspec/AGENTS.md`: "Internal Azure Artifacts feeds only" | No feed exists |

Three scripts implement the vanished infrastructure:

- **`scripts/release.mjs` can never pass.** It requires
  `publishConfig.registry` to match
  `https://pkgs.dev.azure.com/<org>/_packaging/codecrosscheck-npm/npm/registry/`.
  `package.json` declares no registry at all, so `npm run release` exits 1 on
  every invocation. 0.5.0 and 0.5.1 were both shipped by hand around it. A
  release gate that has never once run is not a gate.
- **`scripts/publish-vsix.mjs`** shells `az artifacts universal publish --feed
  codecrosscheck-universal` at a feed that does not exist.
- **`src/install.ts`** has two jobs. Skill installation (`npx
  codecrosscheck-install skill`) works and is used. The default path —
  downloading the `.vsix` from the universal feed — cannot work, and its
  doc comment tells the user to authenticate `az` "against the org".

Separately, and true regardless of where the project publishes: **both release
scripts shell-interpret an interpolated command string.** `scripts/release.mjs`
runs `execSync(`git ${cmd}`)` and `scripts/publish-vsix.mjs` runs

```js
run(`az artifacts universal publish --feed ${FEED} --name ${PACKAGE_NAME} ...`);
```

where `FEED` and `PACKAGE_NAME` come from `process.env`. That violates three
standing rules at once: the `distribution` requirement "Cross-platform release
scripts" ("SHALL be authored as Node ESM (`.mjs`) using `child_process.spawn`
with argument arrays"), the `chat-loop` requirement "Subprocess invocation
SHALL NOT shell-interpret a command string", and `openspec/AGENTS.md`
("Never `exec` a string"). The requirement is correct; the code never met it.

`openspec/project.md` already contains the truthful line — "**Distribution:
local-only.** Users clone the repo, run `npm ci && npm run build`, package the
VSIX with `npx vsce package`" — three lines above the false ones. The file
contradicts itself in a single section.

This is the same failure the 0.5.1 release documented under "A release ships
stale docs by default", but at capability scale: the spec, not just prose.

## What Changes

**Settled, regardless of the decision below.** These correct statements that
are false on any reading:

- The `distribution` spec stops requiring Azure DevOps hosting, the two Azure
  Artifacts feeds, the `@internal/codecrosscheck` package name and the
  `.npmrc` step. Those requirements describe infrastructure that does not
  exist and cannot be satisfied.
- The spec records what is actually true today: a public GitHub repository,
  MIT licensed, built and installed from a locally packaged `.vsix`.
- `openspec/project.md`'s "Audience & distribution" section is made
  self-consistent: the Azure DevOps repo line and the `.npmrc.template` line
  go; the local-only lines stay.
- `openspec/AGENTS.md`'s "Internal Azure Artifacts feeds only" line and the
  `distribution` routing row are corrected.
- `docs/ARCHITECTURE.md` and `README.md` drop their references to the
  universal feed.
- `src/install.ts` keeps the skill installer and stops offering the feed
  download, whose doc comment currently instructs the user to authenticate
  against an organisation that is not there.

**The decision, now taken: local-only.** The release path depends on the
intended target, and the codebase did not record it:

- **Option A — stay local-only. CHOSEN.** `scripts/publish-vsix.mjs` is
  deleted along with the `publish:npm` and `publish:vsix` scripts.
  `scripts/release.mjs` is kept but reduced to a pre-package gate: clean tree,
  branch `main`, package name, and a green `npm run verify`. It publishes
  nothing. `package.json` gains `"private": true` — with the `publish:npm`
  script gone but `publishConfig.access` left at `public`, a stray
  `npm publish` would have gone to the public registry, so the prohibition
  needs an enforcer rather than a sentence. `publishConfig` is removed as
  meaningless once the package is private. Verified that `"private": true`
  does not break `vsce package`.
- **Option B — publish to npm and the Marketplace.** Not taken. Would have
  required a publisher token and a real publish step to maintain, for a
  project with no external consumers.

The earlier draft of Option A proposed deleting `release.mjs` outright. That
was rejected during implementation: a pre-package verification gate is worth
keeping under local-only, and 0.5.0 and 0.5.1 were both released with no gate
at all.

## Impact

- Affected specs: `distribution` (substantially rewritten — every current
  requirement except the `@types/vscode` floor is unsatisfiable as written).
- Affected code: `scripts/release.mjs`, `scripts/publish-vsix.mjs`,
  `src/install.ts`, plus `README.md`, `docs/ARCHITECTURE.md`,
  `openspec/project.md`, `openspec/AGENTS.md`.
- Affected tests: `test/bundle.test.ts` and `test/hygiene.test.ts` must be
  checked for assertions on the removed scripts before anything is deleted.
- Risk: deleting `src/install.ts`'s feed path removes a documented entry point.
  It cannot currently succeed for anyone, so the risk is to documentation
  rather than to a working flow — but `bin.codecrosscheck-install` is a
  published entry point name and must keep working for the skill subcommand.
