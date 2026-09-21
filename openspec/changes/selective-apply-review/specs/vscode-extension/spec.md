# vscode-extension delta: selective-apply-review

## ADDED Requirements

### Requirement: apply-review SHALL let the user choose which findings to apply

`/apply-review` SHALL offer the user a per-finding choice before writing any
edit. Only the edits belonging to selected findings SHALL be applied. The
reviewer is not right every time, and a user who rejects one fix in five must
not have to apply all five and unpick the diff afterwards.

Selection SHALL operate on fixes whose status is `fixed`. A fix with any other
status carries no edits and SHALL NOT be offered.

Selection SHALL default to every eligible finding, so confirming without
changing anything reproduces the current behaviour.

The extension SHALL accept a directive in the `/apply-review` prompt —
`only <findingId>[,<findingId>...]` or `skip <findingId>[,<findingId>...]` —
that determines the selection without presenting a picker. An unrecognised
finding id in a directive SHALL be reported to the user rather than silently
ignored, because a mistyped id would otherwise apply the opposite of what was
asked.

When the user dismisses the picker without confirming, the extension SHALL
apply nothing and SHALL report the run as cancelled rather than as a failure.

The apply log SHALL record the selected and the declined finding ids, so a
later reader can distinguish an edit the user declined from one that failed to
apply.

Dry-run SHALL preview exactly the selected edits.

#### Scenario: A declined finding's edits are not written

- **GIVEN** a stored fix proposal with fixes for three findings
- **AND** the user selects two of them
- **WHEN** the edits are applied
- **THEN** only the edits belonging to the two selected findings are written
- **AND** the files touched only by the third finding are unchanged

#### Scenario: Confirming without changing the selection applies everything

- **GIVEN** a stored fix proposal whose fixes all have status `fixed`
- **WHEN** the user confirms the selection without deselecting anything
- **THEN** every edit in the proposal is applied

#### Scenario: Directive selects without a picker

- **GIVEN** a stored fix proposal with fixes for findings `F1`, `F2` and `F3`
- **WHEN** the user sends `/apply-review only F1,F3`
- **THEN** no picker is presented
- **AND** only the edits for `F1` and `F3` are applied

#### Scenario: Unknown finding id in a directive is reported

- **GIVEN** a stored fix proposal with no finding `F9`
- **WHEN** the user sends `/apply-review skip F9`
- **THEN** the extension reports that `F9` matched no finding in the proposal

#### Scenario: Findings without edits are not offered

- **GIVEN** a stored fix proposal containing a fix with status `disagree`
- **WHEN** the selection is presented
- **THEN** that finding is not among the selectable entries

#### Scenario: Dismissing the picker writes nothing

- **WHEN** the user dismisses the selection without confirming
- **THEN** no edit is written
- **AND** the run is reported as cancelled, not as a failure

#### Scenario: The apply log distinguishes declined from failed

- **GIVEN** a run in which one finding was declined and one edit failed to
  match
- **WHEN** the apply log is read
- **THEN** the declined finding is recorded as declined
- **AND** the failed edit is recorded with its failure reason
