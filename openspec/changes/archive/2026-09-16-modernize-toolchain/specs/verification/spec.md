# verification spec delta

## ADDED Requirements

### Requirement: Test sources SHALL be type-checked

The repository SHALL provide a type-check gate that covers `test/` as well as
`src/`, and that gate SHALL run in CI.

Excluding tests from type-checking means test helpers, fakes, and fixtures
drift from the interfaces they stand in for without any signal, and dead code
inside tests is never reported.

#### Scenario: A type error in a test fails the gate

- **WHEN** a test file references a property that does not exist on the type it
  is testing
- **THEN** the type-check gate fails

#### Scenario: The gate runs in CI

- **WHEN** CI runs for a pull request
- **THEN** the type-check gate is executed and a failure fails the job

### Requirement: The project SHALL enforce a lint configuration

The repository SHALL contain an ESLint configuration covering `src/` and
`test/`, and a `lint` script that CI runs.

A codebase SHALL NOT carry `eslint-disable` directives for a linter it does not
configure, because such directives read as enforced rules while suppressing
nothing.

#### Scenario: Lint runs in CI

- **WHEN** CI runs for a pull request
- **THEN** the lint script is executed and a violation fails the job

#### Scenario: No orphan disable directives remain

- **WHEN** the source tree is searched for `eslint-disable` directives
- **THEN** every rule named is one the configuration actually enables

### Requirement: Compiler strictness SHALL make suppression idioms unnecessary

The TypeScript configuration SHALL enable at least `noUncheckedIndexedAccess`,
`noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` and
`noFallthroughCasesInSwitch` in addition to `strict`.

Symbols that exist only to be discarded SHALL be deleted rather than silenced
with a `void x;` statement. Where a parameter must be kept for signature
compatibility, it SHALL be marked with the configured unused-parameter prefix
rather than referenced in a no-op expression.

#### Scenario: An unused local fails the build

- **WHEN** a source file declares a local that is never read
- **THEN** the build fails rather than requiring a `void` statement to pass

#### Scenario: Unguarded index access is reported

- **WHEN** a source file indexes an array or regex match group without a guard
- **THEN** the compiler reports it

#### Scenario: No void-suppression statements remain

- **WHEN** the source tree is searched for statements of the form `void <identifier>;`
- **THEN** none remain

### Requirement: CI SHALL gate packaging as well as tests

The CI workflow SHALL, on every pull request, run lint, type-check, unit tests,
and produce a VSIX package.

The bundle smoke test guards against a dependency-inlining regression, but the
failure it was written for was a *packaging* failure. Testing the bundle
without exercising packaging leaves that gap open.

#### Scenario: Packaging failure fails CI

- **WHEN** the extension cannot be packaged into a VSIX
- **THEN** CI fails

#### Scenario: All gates run on pull requests

- **WHEN** a pull request is opened against the default branch
- **THEN** lint, type-check, test, and package steps all run

### Requirement: The planted-flaw corpus SHALL be runnable and its skipping visible

The corpus harness SHALL be invocable as a dedicated CI job, triggered on a
schedule or by manual dispatch, with the credentials it requires.

When the corpus is skipped for lack of credentials, the skip SHALL be reported
with its reason rather than appearing as an ordinary skipped test, so a
permanently inert gate cannot masquerade as a passing one.

#### Scenario: Corpus job runs with credentials

- **WHEN** the corpus job is dispatched with a model token available
- **THEN** every corpus case executes and a mismatch fails the job

#### Scenario: Skipping states its reason

- **WHEN** the corpus harness is loaded without the required credentials
- **THEN** the reason for skipping is reported in the test output
