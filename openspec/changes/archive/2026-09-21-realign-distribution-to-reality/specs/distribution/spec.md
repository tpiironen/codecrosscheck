# distribution delta: realign-distribution-to-reality

The publication target is settled here: **local-only**. The project publishes to
no registry and `package.json` sets `"private": true`; nothing is deferred to a
follow-up change. This delta also corrects the statements that were false
regardless of the target — Azure DevOps hosting, the two Azure Artifacts feeds,
the `@internal` package name and the `.npmrc` step.

## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Internal-only hosting

**Reason**: Release 0.4.0 moved the project to a public GitHub repository under
the MIT licence and switched `package.json` `publisher`, `publishConfig` and
`repository` away from internal Azure DevOps. The requirement's hosting clause
has been false since. Its publication clause — that the package SHALL NOT go to
public npm and the extension SHALL NOT go to the Marketplace — is a decision
the project has not recorded either way, and `publishConfig: {"access":"public"}`
points the other way. Replaced by "Source hosting", which states the verified
hosting facts and leaves the publication target open.

**Migration**: None. Nothing has been published to any registry, so no consumer
depends on either reading.

### Requirement: Two-feed split

**Reason**: Neither `codecrosscheck-npm` nor `codecrosscheck-universal` exists.
The Azure DevOps organisation that would host them was left behind by release
0.4.0, and no `az` login is configured. Both scenarios assert the behaviour of
`npm run publish:npm` and `npm run publish:vsix` against those feeds, so
neither can pass or meaningfully fail.

**Migration**: None. No consumer has ever installed from either feed. The
replacement install path is specified by "Consumer install path".
