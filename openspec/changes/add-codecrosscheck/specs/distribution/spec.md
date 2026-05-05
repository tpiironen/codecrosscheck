# Capability: distribution

## ADDED Requirements

### Requirement: Internal-only hosting

The package and the VS Code extension SHALL be hosted exclusively on Azure DevOps (Repos + Azure Artifacts). The package SHALL NOT be published to public npm AND the extension SHALL NOT be published to the VS Code Marketplace or Open VSX.

#### Scenario: Public registry rejected by release script

- **GIVEN** `package.json` `publishConfig.registry` has been altered to `https://registry.npmjs.org/`
- **WHEN** the developer runs `npm run release`
- **THEN** the script exits non-zero with a message naming the offending registry value
- **AND** no publish occurs

### Requirement: Two-feed split

Internal distribution SHALL use two Azure Artifacts feeds: `codecrosscheck-npm` for the CLI npm package AND `codecrosscheck-universal` for `.vsix` artifacts.

#### Scenario: NPM publish targets the npm feed

- **WHEN** `npm run publish:npm` runs
- **THEN** the resolved registry URL contains `codecrosscheck-npm`

#### Scenario: VSIX publish targets the universal feed

- **WHEN** `npm run publish:vsix` runs
- **THEN** the `az artifacts universal publish` invocation references `--feed codecrosscheck-universal`

### Requirement: Manual release script

The repository SHALL provide a single `npm run release` script that orchestrates verification, npm publish, vsix packaging, and universal feed upload. The script SHALL NOT run automatically from CI; it SHALL require an interactive developer invocation from a clean working tree on `main`.

#### Scenario: Dirty tree blocks release

- **GIVEN** `git status --porcelain` is non-empty
- **WHEN** the developer runs `npm run release`
- **THEN** the script exits non-zero before any publish call
- **AND** prints the dirty files

#### Scenario: Wrong branch blocks release

- **GIVEN** the current branch is `feature/x`
- **WHEN** the developer runs `npm run release`
- **THEN** the script exits non-zero with a message stating release must run from `main`

### Requirement: Cross-platform release scripts

All release-side scripts SHALL be authored as Node ESM (`.mjs`) using `child_process.spawn` with argument arrays. They SHALL NOT depend on `bash`, `sh`, or PowerShell-only built-ins.

#### Scenario: Release script runs on Windows and Linux

- **GIVEN** identical clean checkouts on Windows and Linux with Node 20 AND `az` CLI installed
- **WHEN** `npm run release` runs on either machine
- **THEN** the same publish steps execute in the same order

### Requirement: Consumer install path

Consumers SHALL be able to install the CLI with a single `npm install -g @internal/codecrosscheck` after a one-time `.npmrc` configuration. They SHALL be able to install the VS Code extension with `npx @internal/codecrosscheck install` (or by manually downloading the `.vsix` from the universal feed and running `code --install-extension`).

#### Scenario: Fresh machine CLI install

- **GIVEN** a fresh machine with Node 20 AND a configured `.npmrc` referencing the npm feed
- **WHEN** the developer runs `npm install -g @internal/codecrosscheck`
- **THEN** `codecrosscheck --help` exits with code 0

#### Scenario: One-liner extension install

- **GIVEN** a machine with `code` on PATH AND `az` CLI authenticated against the org
- **WHEN** the developer runs `npx @internal/codecrosscheck install`
- **THEN** the latest `.vsix` is downloaded from `codecrosscheck-universal`
- **AND** `code --install-extension` is invoked with the downloaded path
- **AND** the installer exits with code 0

### Requirement: Workspace recommendation

The repository SHALL contain `.vscode/extensions.json` recommending the CodeCrossCheck extension by its publisher.name id, so that team members opening the repo are prompted to install it.

#### Scenario: Recommendation prompt

- **WHEN** a team member opens the repository in VS Code without the extension installed
- **THEN** VS Code surfaces the recommendation banner referencing CodeCrossCheck
