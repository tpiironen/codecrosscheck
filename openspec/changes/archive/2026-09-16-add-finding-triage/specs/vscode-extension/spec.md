# vscode-extension delta: add-finding-triage

## ADDED Requirements

### Requirement: review-branch SHALL triage findings before drafting fixes

`/review-branch` SHALL run triage on the reviewer's findings before the worker
drafts any fix, and SHALL pass only findings whose triage status is `confirmed`
to the fix-drafting step.

Findings with status `rejected` or `uncertain` SHALL be reported to the user
with their evidence, and SHALL NOT produce fix text. A finding the worker
cannot support must not become an edit.

The triage step SHALL receive the repository file context already harvested for
the cited paths, so that it judges against current source rather than from the
finding's wording alone.

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
