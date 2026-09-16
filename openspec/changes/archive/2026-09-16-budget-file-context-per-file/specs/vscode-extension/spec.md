# vscode-extension delta: budget-file-context-per-file

## MODIFIED Requirements

### Requirement: review-branch repository file context

The extension SHALL harvest workspace-relative file paths before each
fixer iteration of `/review-branch` (iteration ≥ 2) from
(a) each reviewer finding's `where` and `suggestion` fields, and
(b) the worker's prior fix proposal (both `// path:` directives and
free-text mentions). The extension SHALL read the current contents
of those files (filtering out URLs, absolute Windows paths, and
host-prefixed paths) and inject them as a `# Repository file
context` section in the fixer input, capped at 60 000 characters.
The fixer system prompt SHALL describe this section as canonical
current source and SHALL forbid responding with
"I need the source" / "Data I need" placeholders when the file is
present in that section.

The character budget SHALL be allocated across the cited files rather than
applied as a single prefix cut over their concatenation. Every cited file that
resolves to readable content SHALL be represented in the block. A file SHALL NOT
be omitted merely because an earlier file consumed the budget.

Where a file's contents are shorter than its share of the budget, the unused
remainder SHALL be made available to the remaining files.

Where a file cannot be included whole, it SHALL be truncated individually and
its header SHALL state that it is partial. The retained portion SHALL include
both the beginning and the end of the file, with the elision marked, because a
finding may cite a symbol anywhere in the file.

#### Scenario: Cited file larger than the whole budget

- **GIVEN** two cited files, the first of which alone exceeds the budget
- **WHEN** the file context block is built
- **THEN** both files appear in the block
- **AND** the first is marked as partial rather than silently cut

#### Scenario: Small file is not padded out

- **GIVEN** a cited file far smaller than its equal share of the budget
- **WHEN** the file context block is built
- **THEN** that file appears in full
- **AND** the share it did not use is available to the other cited files

#### Scenario: Truncation preserves the end of the file

- **GIVEN** a cited file that must be truncated
- **WHEN** it is added to the block
- **THEN** the retained text includes the start and the end of the file
- **AND** the omission between them is explicitly marked

#### Scenario: Everything fits

- **GIVEN** cited files whose combined size is within the budget
- **WHEN** the block is built
- **THEN** every file appears in full and none is marked partial

#### Scenario: Reviewer cites a file outside the branch diff

- **GIVEN** a reviewer finding whose `where` references a file not
  modified by the branch
- **WHEN** the fixer iteration runs
- **THEN** that file's current contents are included in the
  `# Repository file context` section
- **AND** the fixer produces a concrete unified-diff hunk against
  it rather than a "Data I need" placeholder

#### Scenario: Cited path is a URL or absolute path

- **GIVEN** a reviewer finding whose text mentions
  `https://example.com/foo.ts` or `C:/temp/bar.cs`
- **WHEN** path harvesting runs
- **THEN** neither path is included in the file context
