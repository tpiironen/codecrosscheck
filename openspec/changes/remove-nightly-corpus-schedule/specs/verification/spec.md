# verification spec delta

## MODIFIED Requirements

### Requirement: The planted-flaw corpus SHALL be runnable and its skipping visible

The corpus harness SHALL be invocable as a dedicated CI job, triggered by manual
dispatch, with the credentials it requires.

The job SHALL NOT be triggered on a schedule. Each run spends model tokens, so
an unattended trigger bills for runs nobody requested; a gate whose credentials
are absent also fails on every such run, and recurring red teaches reviewers to
ignore it.

When the corpus is skipped for lack of credentials, the skip SHALL be reported
with its reason rather than appearing as an ordinary skipped test, so a
permanently inert gate cannot masquerade as a passing one.

#### Scenario: Corpus job runs with credentials

- **WHEN** the corpus job is dispatched with a model token available
- **THEN** every corpus case executes and a mismatch fails the job

#### Scenario: No unattended corpus run is triggered

- **WHEN** the CI workflow's triggers are inspected
- **THEN** no schedule trigger is present, and the corpus job is reachable only
  by manual dispatch

#### Scenario: Skipping states its reason

- **WHEN** the corpus harness is loaded without the required credentials
- **THEN** the reason for skipping is reported in the test output
