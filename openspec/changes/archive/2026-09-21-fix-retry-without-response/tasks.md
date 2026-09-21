# Tasks: fix-retry-without-response

- [x] 1.1 In `src/clients/vscodeLm.ts` `sendStructured`, build the retry
      messages from the original messages when the first attempt produced no
      text, and only append the assistant echo + reminder when it did.
- [x] 1.2 Apply the same change to `src/clients/openaiCompatible.ts`
      `sendStructured`.
- [x] 1.3 Confirm the two-strike error message still names both the first and
      the retry error, so the originating transport failure stays visible.
      — pinned by "still reports the originating failure when the retry also
      fails" in `test/retry.test.ts`.
- [x] 1.4 Add tests: a first attempt that throws re-sends the original messages
      with no assistant turn and no "not valid JSON" reminder; the existing
      echo behaviour is unaffected when text was produced.
      — 2 tests in `test/retry.test.ts`, 2 in `test/openaiCompatible.test.ts`.
      Three separate assertions (no assistant turn, no reminder, messages
      unchanged) were consolidated into one test per client during the
      commit-readiness pass: the strict-equality assertion subsumes the other
      two, so they caught no failure it would have missed.
- [x] 1.5 Red-proof: restore the unconditional echo and confirm the new tests
      fail, and only those. — after consolidation, exactly 1 of 9 in
      `test/retry.test.ts` and 1 of 18 in `test/openaiCompatible.test.ts`. The
      two control tests (originating failure still reported, echo retained when
      text was produced) were proved red separately against their own targets:
      dropping `firstError` from the two-strike message, and never echoing.
- [x] 1.6 Run lint, both typechecks, the full suite, and
      `npx openspec validate fix-retry-without-response --strict`.
      — all green; 261 passed / 8 skipped, validate 13/13 repo-wide.
