# Change: measure-token-consumption

## Why

Token consumption has been raised repeatedly as a concern and addressed six
times, each time by reasoning about character counts:

| Archived change | What it traded |
| --- | --- |
| `guard-oversized-review-prompts` | refuse a prompt over the context window |
| `budget-file-context-per-file` | cap per-file harvested context |
| `raise-review-branch-diff-budget` | raise `maxDiffChars` |
| `trim-rereview-diff-context` | scope the re-review diff to cited files |
| `scope-review-to-branch-files` | scope review to branch files |
| `remove-nightly-corpus-schedule` | stop billing tokens for unrequested runs |

Not one of them could measure the thing it was changing. `trim-rereview-diff-
context` had to estimate from a transcript by hand — "the diff is 178,575
chars ... on the order of 150,000 input tokens" — because chars are the only
size the project records.

The transcript records `diffChars` and `resultChars`. It records no token count
for any model call. `model.countTokens` **is** already called, in exactly one
place: the oversized preflight in `src/extension.ts`, which compares the
assembled reviewer prompt against `floor(maxInputTokens * 0.9)`. Its result is
used for a warning and then discarded.

So the project's position on its most-cited concern is: six changes shipped,
no baseline, no per-run figure, and no way to tell whether any of them helped.
A seventh optimisation would be argued the same way — from a char count and a
division.

The cheap thing is not another optimisation. It is the measurement that would
let the next one be judged.

## What Changes

- Every model call made by `/review-branch`, `/openspec-review` and the staged
  pipeline SHALL record its prompt size in the transcript: the agent, the model
  id, the character count, and the token count where the provider can supply
  one.
- Token counting SHALL reuse the existing `countTokens` path and SHALL remain
  best-effort. A provider that cannot count tokens SHALL record the character
  count alone; it SHALL NOT fail the run, matching how the preflight already
  swallows a throwing `countTokens`.
- The preflight SHALL record the count it already computes rather than
  discarding it.
- A run's terminal transcript event SHALL carry the run total, so the cost of a
  whole `/review-branch` is one field rather than a summation the reader has to
  perform.
- No budget, cap or limit changes. This change measures; it does not optimise.

## Out of scope

- Changing any existing budget or introducing a token-based cap. Both should
  follow the measurement, not precede it.
- Cost estimation in currency. Rates are per-provider and per-contract, and the
  project has no record of either.
- Reducing consumption. The next optimisation is a separate change, and its
  proposal should cite figures this one makes available.

## Impact

- Affected specs: `chat-loop` (extends the JSONL transcript requirement).
- Affected code: `src/transcript.ts` (event shape), `src/extension.ts` (call
  sites and the preflight), `src/pipeline.ts` if it writes its own call events.
- Risk: low. Recording is additive and best-effort. The one real risk is
  `countTokens` adding latency to every call; it SHALL be measured on a real
  run before the change is archived, and dropped from the hot path if it is not
  negligible.
