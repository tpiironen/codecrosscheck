# distribution delta: pin-vscode-api-floor

## ADDED Requirements

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
