# Change: trim-rereview-diff-context

## Why

`/review-branch` sends the entire branch diff on every model call. Measured on
a real run of this repository (transcript
`2026-09-14T12-25-09-360Z.jsonl`): the diff is 178,575 chars, and a two-
iteration run made three calls that each carried it in full — 535,725 chars of
duplicated diff, on the order of 150,000 input tokens, to produce two findings.
A six-iteration run makes up to eleven calls and would approach 2,000,000
chars.

The re-review call is the clearest waste. `buildRereviewInput` embeds the whole
diff as "BEFORE state" and then spends a paragraph instructing the reviewer to
disregard it: "the diff is unchanged by design", "do NOT re-flag a finding just
because the diff still shows the original problem". It pays for a large payload
and then argues against it.

The reviewer does not need files it made no finding about. Each finding already
carries `where` and `suggestion`, and the extension already harvests paths from
exactly those fields to build the fixer's file context.

## What Changes

- On re-review (iteration ≥ 2), the diff included in the reviewer prompt is
  filtered to the files cited by the prior findings and by the worker's fix
  proposal, reusing the existing `harvestPathsFromText` and
  `filterPatchToScope` helpers.
- The prompt states that the diff is scoped and how many files were omitted, so
  the reviewer is not misled into thinking the branch is smaller than it is.
- When no cited path matches a file in the diff, the full diff is sent
  unchanged. Scoping must never produce an empty or near-empty context.
- The first review pass is unaffected and still sees the complete diff.

## Impact

- Affected specs: `vscode-extension` (new requirement; the existing
  "review-branch repository file context" requirement covers the fixer input
  only and is untouched).
- Affected code: `src/extension.ts` (`buildRereviewInput` and its call site).
- No configuration change. No change to the first-pass review.
- Expected saving on the measured run: one of three calls drops from 178,575
  chars to the hunks for the cited files only.
- Risk: if path harvesting misses a file the reviewer needed, it sees less
  context than before and could mis-judge a fix. The full-diff fallback covers
  the total-miss case; a partial miss remains possible, which is why the prompt
  names the omission explicitly rather than hiding it.
