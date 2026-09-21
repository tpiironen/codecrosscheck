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

While the corpus has never been executed, the project SHALL record that fact
wherever a reader would otherwise infer that reviewer prompt behaviour is
covered, and SHALL NOT describe that behaviour as verified.

Any instruction to run the corpus SHALL state the prerequisite it depends on
and whether the project has it. An instruction to run a gate the project cannot
run reads as a process someone follows, which is how an untested area comes to
be believed tested.

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

#### Scenario: Documentation does not imply coverage the gate never gave

- **WHEN** a contributor reads the project's description of its test gates
- **THEN** the corpus is described as never having been executed, rather than
  as a gate that runs on demand

#### Scenario: Run instructions name the missing prerequisite

- **WHEN** a document tells the reader how to run the corpus
- **THEN** it states that an OpenAI-compatible endpoint is required and that
  none is configured for this project
