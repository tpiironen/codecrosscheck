# vscode-extension delta: trim-rereview-diff-context

## ADDED Requirements

### Requirement: review-branch re-review diff scoping

The extension SHALL scope the branch diff sent to the reviewer on re-review
passes (iteration ≥ 2) of `/review-branch` to only those files cited by the
prior findings and by the worker's fix proposal. The cited paths SHALL be the
same set already harvested for the fixer's repository file context, derived
from each finding's `where` and `suggestion` fields and from the fix proposal.

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
