# Tasks: measure-token-consumption

## 1. Recording

- [ ] 1.1 Define the call-size transcript event in `src/transcript.ts`: agent,
      model id, prompt chars, optional prompt tokens.
- [ ] 1.2 Record it at every model call site in `src/extension.ts`
      (reviewer, worker/fixer, triager) and in `src/pipeline.ts` if it writes
      its own call events.
- [ ] 1.3 Make the oversized preflight emit its computed token count instead of
      discarding it. Keep its existing behaviour when `countTokens` throws.
- [ ] 1.4 Accumulate per-run totals and add them to the terminal event
      (`review-branch-done`, `completed`).
- [ ] 1.5 Confirm the CLI path degrades cleanly: `OpenAiCompatibleClient` has no
      token counter, so those records carry chars only.

## 2. Tests

- [ ] 2.1 A call records agent, model id and prompt chars.
- [ ] 2.2 A throwing `countTokens` yields a chars-only record and does not fail
      the run.
- [ ] 2.3 The terminal event's total equals the sum of the per-call records.
- [ ] 2.4 Red-proof 2.3 by dropping one call from the accumulator and confirming
      only that test fails.

## 3. Measurement

- [ ] 3.1 Run `/review-branch` once on this repository and record the actual
      per-call and total figures in this change's proposal. A measurement
      change that ships without a measurement has not been demonstrated.
- [ ] 3.2 Time the run with and without `countTokens` on the hot path. If the
      added latency is not negligible, move counting off the call path or drop
      it, and record which was chosen and why.

## 4. Gates

- [ ] 4.1 `npx openspec validate measure-token-consumption --strict`.
- [ ] 4.2 Lint, both typechecks, full suite, `npm run build`.
- [ ] 4.3 Dogfood: `@codecrosscheck /review-branch` on this change's branch.
