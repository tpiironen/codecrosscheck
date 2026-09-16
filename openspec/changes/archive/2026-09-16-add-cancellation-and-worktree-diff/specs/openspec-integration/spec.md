# openspec-integration spec delta

## MODIFIED Requirements

### Requirement: Diff-only reviewer context

The reviewer prompt in OpenSpec mode SHALL receive the patch produced by the
diff slicer instead of the full workspace contents. The slicer's default
coverage is defined by "The diff slicer SHALL include uncommitted work by
default"; this requirement SHALL NOT restate a fixed git command, because
pinning `git diff <mergeBase>...HEAD` here contradicted that default. The patch
SHALL be restricted to files within the change's stated impact AND chunked to
fit the configured token budget.

#### Scenario: Out-of-scope files filtered

- **GIVEN** a change whose impact lists `src/loop.ts`
- **WHEN** the diff slicer runs against a worktree that also modifies `src/unrelated.ts`
- **THEN** only the `src/loop.ts` hunks are included in the reviewer prompt

#### Scenario: Large diffs chunked

- **GIVEN** a diff whose estimated token size exceeds the configured budget
- **WHEN** the chunker runs
- **THEN** the patch is split per file
- **AND** each chunk is below the budget
- **AND** consecutive chunks share at least 2 lines of overlap context

## ADDED Requirements

### Requirement: The diff slicer SHALL include uncommitted work by default

`getChangeDiff` SHALL, by default, produce a diff that covers committed
branch history *and* the current working tree, so a review reflects what the
author is actually looking at. Coverage SHALL include changes staged in the
index and unstaged modifications to tracked files.

Callers SHALL be able to opt out and request a commit-to-commit diff only.

Untracked files are out of scope for this requirement; a reviewer cannot be
expected to judge files git does not track, and including them risks pulling
build output and secrets into a prompt.

#### Scenario: Uncommitted edits appear in the default diff

- **WHEN** a tracked file has unstaged modifications and `getChangeDiff` is
  called with default options
- **THEN** those modifications appear in the returned patch

#### Scenario: Staged edits appear in the default diff

- **WHEN** a tracked file has staged-but-uncommitted modifications
- **THEN** those modifications appear in the returned patch

#### Scenario: Committed-only mode is available

- **WHEN** `getChangeDiff` is called with the committed-only option
- **THEN** the returned patch covers the commit range only and excludes
  working-tree state

#### Scenario: Untracked files are excluded

- **WHEN** the working tree contains an untracked file
- **THEN** that file does not appear in the returned patch

### Requirement: The diff slicer SHALL report the range it compared

`getChangeDiff` SHALL return, alongside the patch text, a human-readable
description of what was compared — the resolved base ref and whether the
working tree was included — so the surface presenting the review can state it.

The `/review-branch` header SHALL render that description, so a user can tell
at a glance whether their uncommitted edits were part of the review.

#### Scenario: Header names the compared range

- **WHEN** `/review-branch` runs with default options
- **THEN** its header states the resolved base and that the working tree was
  included

#### Scenario: Explicit base is reflected in the description

- **WHEN** the caller supplies `diff-base=<ref>`
- **THEN** the description names that ref
