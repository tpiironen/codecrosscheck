# vscode-extension delta: correct-vscode-extension-spec-drift

## MODIFIED Requirements

### Requirement: VS Code settings

The extension SHALL contribute at least the following settings under the `codecrosscheck.*` namespace, each with a default value AND a user-visible description:

- `codecrosscheck.workerModel`
- `codecrosscheck.reviewerModel`
- `codecrosscheck.maxIters`
- `codecrosscheck.execute.timeoutMs`

This list is a minimum, not the complete contributed set. Settings added by
later changes SHALL NOT require an amendment here, but a setting named here
SHALL exist.

`codecrosscheck.execute.allowNetwork` SHALL NOT be contributed. The sandbox
does not restrict network access, so the setting would advertise a boundary
that does not exist.

#### Scenario: Setting overrides default model

- **GIVEN** `codecrosscheck.workerModel` is set to `openai/gpt-4.1` in workspace settings
- **WHEN** the participant builds the worker client
- **THEN** the worker uses the `openai/gpt-4.1` model family

### Requirement: review-branch re-review diff scoping

The extension SHALL scope the branch diff sent to the reviewer on re-review
passes (iteration ≥ 2) of `/review-branch` to only those files touched by the
worker's fix proposal. The cited paths SHALL be the distinct `path` values of
the proposal's edits. The reviewer on a re-review pass is judging a proposal,
not re-reading the branch, so files the proposal does not edit are not part of
what it has to decide.

The initial review pass SHALL continue to receive the complete branch diff.

When the scoped patch is empty — because no cited path matched a file in the
diff — the extension SHALL send the complete diff instead. Scoping SHALL NOT
be allowed to reduce the reviewer's context to nothing.

The re-review prompt SHALL state that the diff has been scoped and SHALL report
how many files were omitted, so the reviewer is not misled into treating the
scoped diff as the whole branch.

The extension SHALL record the scoping outcome in the re-review
`review-branch-iter` transcript event, including the number of characters sent,
the number of files included and the number omitted.

#### Scenario: Findings cite a subset of the changed files

- **GIVEN** a branch diff touching ten files
- **AND** a prior verdict whose findings cite two of them
- **WHEN** the re-review prompt is built
- **THEN** the diff in the prompt contains only those two files
- **AND** the prompt states that eight files were omitted

#### Scenario: No cited path matches the diff

- **GIVEN** a prior verdict whose findings cite no path present in the diff
- **WHEN** the re-review prompt is built
- **THEN** the complete branch diff is sent
- **AND** the prompt does not claim that any file was omitted

#### Scenario: Initial pass is unaffected

- **WHEN** the first reviewer call of `/review-branch` is made
- **THEN** it receives the complete branch diff regardless of any scoping

#### Scenario: Scoping is measurable from the transcript

- **WHEN** a re-review pass completes
- **THEN** its `review-branch-iter` transcript event records the characters
  sent and the counts of included and omitted files

### Requirement: review-branch SHALL triage findings before drafting fixes

`/review-branch` SHALL run triage on the reviewer's findings before the worker
drafts any fix, and SHALL pass only findings whose triage status is `confirmed`
to the fix-drafting step.

Findings with status `rejected` or `uncertain` SHALL be reported to the user
with their evidence, and SHALL NOT produce fix text. A finding the worker
cannot support must not become an edit.

The triage step SHALL be granted the workspace toolset, so that it reads the
cited paths from current source rather than judging from the finding's wording
alone. Its prompt input SHALL carry the verdict, the diff description and the
scope block; the source itself SHALL be obtained through tool calls, which are
subject to the same confinement, budget and auditing as any other agent's.

When the `force-fix-all` directive is present, triage SHALL be bypassed and
every finding SHALL be treated as confirmed. The directive exists for the user
to overrule the worker.

When every finding is rejected, `/review-branch` SHALL report that the code was
defended against the findings, and SHALL NOT report the run as an approved fix
proposal. These are different outcomes and conflating them hides the result the
user most needs.

The extension SHALL record triage results in a `review-branch-triage`
transcript event, including each finding's id, status and evidence.

#### Scenario: A rejected finding never reaches the fixer

- **GIVEN** a reviewer verdict with two findings
- **AND** triage rejects one of them with evidence
- **WHEN** the fix-drafting step runs
- **THEN** it receives only the confirmed finding
- **AND** the rejected finding is shown to the user with its evidence

#### Scenario: Every finding rejected

- **GIVEN** a reviewer verdict whose findings are all rejected by triage
- **WHEN** the iteration completes
- **THEN** the run reports that the code was defended
- **AND** no fix proposal is presented for application

#### Scenario: force-fix-all overrules triage

- **GIVEN** a user prompt containing `force-fix-all`
- **WHEN** `/review-branch` runs
- **THEN** triage does not run
- **AND** every finding is drafted against

#### Scenario: Triage is recorded for later steps

- **WHEN** a triage step completes
- **THEN** a `review-branch-triage` transcript event records each finding's id,
  status and evidence
