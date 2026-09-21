# distribution Specification

## Purpose
TBD - created by archiving change add-codecrosscheck. Update Purpose after archive.
## Requirements
### Requirement: Manual release script

The repository SHALL provide a single `npm run release` script that gates the
working state before the extension is packaged. It SHALL verify a clean working
tree, the `main` branch, the expected package name, `"private": true`, and a
green `npm run verify`. It SHALL NOT run automatically from CI; it SHALL
require an interactive developer invocation.

The script SHALL publish nothing, and SHALL NOT gate on a registry URL.
`package.json` declares no registry, and the previous Azure Artifacts gate
rejected every invocation — the script has never completed a release, and two
releases shipped around it unnoticed.

The repository SHALL NOT provide `publish:npm` or `publish:vsix` scripts while
distribution is local-only. A publish command that exists is a publish command
someone runs.

#### Scenario: Dirty tree blocks release

- **GIVEN** `git status --porcelain` is non-empty
- **WHEN** the developer runs `npm run release`
- **THEN** the script exits non-zero before any further check
- **AND** prints the dirty files

#### Scenario: Wrong branch blocks release

- **GIVEN** the current branch is `feature/x`
- **WHEN** the developer runs `npm run release`
- **THEN** the script exits non-zero with a message stating release must run from `main`

#### Scenario: A publishable manifest blocks release

- **GIVEN** `package.json` no longer sets `"private": true`
- **WHEN** the developer runs `npm run release`
- **THEN** the script exits non-zero naming the missing `private` flag

#### Scenario: Gates pass on a clean checkout of main

- **GIVEN** a clean working tree on `main` and a green `npm run verify`
- **WHEN** the developer runs `npm run release`
- **THEN** the script exits zero
- **AND** directs the developer to `vsce package`
- **AND** publishes nothing

### Requirement: Cross-platform release scripts

All release-side scripts SHALL be authored as Node ESM (`.mjs`) using `child_process.spawn` with argument arrays. They SHALL NOT depend on `bash`, `sh`, or PowerShell-only built-ins.

#### Scenario: Release script runs on Windows and Linux

- **GIVEN** identical clean checkouts on Windows and Linux with Node 20 AND `az` CLI installed
- **WHEN** `npm run release` runs on either machine
- **THEN** the same publish steps execute in the same order

### Requirement: Consumer install path

Consumers SHALL be able to install the VS Code extension by cloning the
repository, running `npm ci && npm run build`, packaging with
`npx vsce package --no-dependencies`, and running `code --install-extension`
against the produced `.vsix`. This procedure SHALL be documented in the README.

The `codecrosscheck-install` binary SHALL install the delegation skill
(`npx codecrosscheck-install skill`). It SHALL NOT offer to download a `.vsix`
from an Azure Artifacts universal feed, because no such feed exists and the
attempt fails after instructing the user to authenticate against an
organisation that is not there. Invoked with no recognised subcommand, it SHALL
print usage naming the documented build-and-install procedure and exit
non-zero.

A `.npmrc` configuration step SHALL NOT be required. `.npmrc.template` was
removed in release 0.4.0.

#### Scenario: Documented install procedure succeeds from a clean clone

- **GIVEN** a clean clone with Node 20 and `code` on PATH
- **WHEN** the developer follows the README install procedure
- **THEN** a `.vsix` is produced and installed, and `@codecrosscheck` appears
  in chat suggestions

#### Scenario: Skill installation needs no external service

- **WHEN** `npx codecrosscheck-install skill` runs
- **THEN** the bundled skill is written to the workspace skills directory
- **AND** no `az` CLI invocation is attempted

#### Scenario: No subcommand prints the documented procedure

- **WHEN** `npx codecrosscheck-install` runs with no subcommand
- **THEN** it prints the build-and-install procedure and exits non-zero
- **AND** attempts no download

### Requirement: Workspace recommendation

The repository SHALL contain `.vscode/extensions.json` recommending the CodeCrossCheck extension by its publisher.name id, so that team members opening the repo are prompted to install it.

#### Scenario: Recommendation prompt

- **WHEN** a team member opens the repository in VS Code without the extension installed
- **THEN** VS Code surfaces the recommendation banner referencing CodeCrossCheck

### Requirement: Declared VS Code API floor SHALL be enforced by typecheck

The declared `engines.vscode` range SHALL be a version the extension actually
compiles against. The `@types/vscode` dependency SHALL use a tilde range
matching that floor, so that `npm run typecheck` validates the source against
the oldest supported API surface rather than against whatever newer typings npm
happens to resolve.

A caret range on `@types/vscode` SHALL NOT be used. Because the typings are
versioned `1.x`, a caret accepts every later minor release and silently
disables this check.

Raising `engines.vscode` SHALL be justified by a compilation failure at the
previous floor, not by inspection of an API list. Reviewing which APIs "should"
be available has already produced a wrong answer by omitting a call site.

#### Scenario: Typings cannot drift past the declared floor

- **GIVEN** `engines.vscode` declares a minimum version
- **WHEN** dependencies are installed
- **THEN** the resolved `@types/vscode` version matches that minimum's minor
  release

#### Scenario: Using a newer API is a build error

- **GIVEN** source that references an API introduced after the declared floor
- **WHEN** `npm run typecheck` runs
- **THEN** it fails, rather than compiling and failing silently at runtime on
  the minimum supported version

### Requirement: Source hosting

The project SHALL be hosted in the public GitHub repository declared by
`package.json` `repository.url`, under the MIT licence, with continuous
integration provided by GitHub Actions.

The specification SHALL NOT require hosting on Azure DevOps Repos or Azure
Artifacts. That infrastructure was left behind by release 0.4.0 and no longer
exists, so a requirement naming it can be neither satisfied nor falsified.

The project SHALL NOT publish to any registry. Distribution is local-only:
artifacts are built from a clone and installed from the working copy.

`package.json` SHALL set `"private": true`. A prohibition that relies on nobody
running a command is not enforced, and the previous enforcement attempt —
matching `publishConfig.registry` against an Azure Artifacts URL — was both
unsatisfiable and in the wrong place.

#### Scenario: Declared repository is the hosting location

- **WHEN** `package.json` `repository.url` is read
- **THEN** it names the public GitHub repository that holds the source

#### Scenario: CI runs on the hosting platform

- **WHEN** a pull request is opened
- **THEN** the GitHub Actions workflow runs build and tests on Ubuntu and
  Windows

#### Scenario: Publishing is blocked by the manifest, not by convention

- **WHEN** `package.json` is read
- **THEN** `private` is `true`
- **AND** no `publishConfig` is declared

