# Capability: vscode-extension (delta)

## MODIFIED Requirements

### Requirement: /review-branch slash command

The participant SHALL accept `/review-branch [extra instructions]`. The
handler SHALL compute the current branch diff against the merge-base
with `origin/main` (or `HEAD` if no remote tracking ref is found) and
run a reviewer-first dialogue loop. Iteration 1 SHALL be a single
CODE-reviewer pass on the diff; iterations 2..N SHALL invoke the
worker to produce a fix proposal addressing every reviewer finding,
followed by a reviewer re-judgement of whether those fixes resolve
the prior findings without introducing new issues. The loop SHALL
terminate when the reviewer returns `approve` or when
`codecrosscheck.maxIters` is reached. The handler SHALL NOT delegate
to `runPipeline` or to the PLAN stage.

#### Scenario: Branch diff is reviewed and fixes proposed

- **GIVEN** a branch with committed changes ahead of `origin/main`
- **WHEN** the user sends `@codecrosscheck /review-branch focus on auth`
- **THEN** iteration 1 streams a reviewer verdict citing file:line
  findings on the diff
- **AND** iteration 2 streams a worker-authored fix proposal whose
  sections correspond one-for-one to the reviewer findings
- **AND** iteration 2 also streams a reviewer re-judgement of the
  proposal
- **AND** the chat output streams a clickable transcript link

#### Scenario: Loop terminates on approval

- **GIVEN** the reviewer returns `approve` after iteration N
- **WHEN** the loop checks the verdict
- **THEN** further iterations SHALL NOT run
- **AND** the summary card SHALL show
  `✅ Approved after N iteration(s)`

#### Scenario: Loop terminates on iteration cap

- **GIVEN** the reviewer keeps returning `revise` through
  `codecrosscheck.maxIters` iterations
- **WHEN** the cap is reached
- **THEN** the handler SHALL emit a summary card containing severity
  counts of remaining issues, the latest worker fix proposal in full,
  total elapsed time, and explicit next-steps guidance
  (raise `maxIters`, scope the prompt, or take the proposal as a
  starting point)

#### Scenario: No remote tracking ref

- **GIVEN** a workspace where `origin/main` cannot be resolved
- **WHEN** the user sends `@codecrosscheck /review-branch`
- **THEN** the handler falls back to `HEAD` as the base and proceeds

## ADDED Requirements

### Requirement: Final summary card on every chat-participant flow

Every `@codecrosscheck` flow that runs a worker↔reviewer loop SHALL
end with a summary card containing: an outcome banner
(`✅ Approved` or `⚠️ Did not converge`), total iterations,
elapsed time in seconds, severity counts of any remaining issues
(high / medium / low), the final artifact rendered in full inside an
HTML `<details>` block, and a clickable transcript link. When the
outcome is "did not converge", the card SHALL also include
next-steps guidance.

#### Scenario: Approved run

- **GIVEN** a flow that converges on iteration 2 of 3
- **WHEN** the loop exits with `approved=true`
- **THEN** the chat shows
  `✅ Approved after 2 iteration(s) ... in <X>s`
- **AND** the final artifact is rendered in an open `<details>` block

#### Scenario: Cap-reached run

- **GIVEN** a flow that exhausts `maxIters` without approval
- **WHEN** the loop exits with `approved=false`
- **THEN** the chat shows the warning banner with severity counts
- **AND** the final artifact is rendered in a closed `<details>` block
- **AND** the next-steps guidance text is visible

### Requirement: Live agent-status streaming

The chat participant SHALL stream progress incrementally during a
flow. For each iteration, the handler SHALL emit a header
`Iteration <N> / <maxIters>`, call `stream.progress(...)` while the
worker or reviewer call is in flight, and render the worker artifact
and reviewer verdict as soon as each call returns. Reviewer issues
SHALL be grouped by severity (high / medium / low) with corresponding
🔴 / 🟡 / 🔵 icons.

#### Scenario: Live progress during long calls

- **GIVEN** a worker or reviewer call that takes more than a few
  seconds
- **WHEN** the call is in flight
- **THEN** the chat shows a `stream.progress(...)` indicator naming
  the model and the action ("drafting fixes", "reading diff",
  "checking fixes")
