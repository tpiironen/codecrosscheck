# vscode-extension spec delta

## MODIFIED Requirements

### Requirement: The fixer SHALL request context rather than receive a harvest

`/review-branch` SHALL NOT pre-inject a block of file contents assembled by
scraping paths out of reviewer findings and worker prose. The worker SHALL
obtain the source it needs through the workspace toolset.

The path-harvesting, path-resolution, inventory-assembly, and dodge-detection
helpers that exist solely to support pre-injection SHALL be removed, along
with the character cap that silently truncated the injected block.

A finding the worker could not address SHALL be reported because the worker
said so in a structured field, not because a regex matched an English phrase in
its prose.

#### Scenario: Worker obtains an unlisted file type

- **WHEN** a finding cites a file whose extension is not in the former
  harvesting allowlist
- **THEN** the worker can still read it through the toolset and produce a
  concrete fix

#### Scenario: Unaddressed findings are reported structurally

- **WHEN** the worker cannot produce a fix for a finding
- **THEN** that is reported from a structured field in its response, and no
  prose-matching heuristic is consulted

#### Scenario: No truncation of injected context

- **WHEN** a run needs more source than the former cap allowed
- **THEN** no context block is truncated, because none is pre-injected

### Requirement: The fixer SHALL emit structured edits directly

The fix proposal SHALL carry machine-applicable edits alongside its
explanation, so `/apply-review` applies what the fixer produced rather than
re-deriving it from Markdown with a second model.

The diff-marker translation prompt and the candidate-repair helpers that
recover from that lossy round trip SHALL be removed.

`/apply-review` SHALL remain as the user-confirmation checkpoint: it presents
the pending edits, applies them on confirmation, and runs the build gate.

#### Scenario: Applying uses the fixer's own edits

- **WHEN** `/apply-review` runs against a transcript produced by the new fixer
- **THEN** it applies the edits recorded in that transcript without a further
  model call to derive them

#### Scenario: Confirmation checkpoint is preserved

- **WHEN** `/apply-review` runs
- **THEN** the user still sees the pending edits and the dry-run setting is
  still honoured

#### Scenario: Edits remain path-validated

- **WHEN** an edit's path resolves outside the workspace root
- **THEN** it is skipped with a reason, as before
