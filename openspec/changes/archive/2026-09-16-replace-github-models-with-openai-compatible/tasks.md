# Tasks: replace-github-models-with-openai-compatible

- [x] 1.1 Add `src/clients/openaiCompatible.ts` with `OpenAiCompatibleClient`,
      carrying over the schema/retry/refusal behaviour unchanged.
- [x] 1.2 Resolve the base URL from an explicit option then
      `CODECROSSCHECK_BASE_URL`, with no provider default. Throw a named error
      when unset.
- [x] 1.3 Make the API key optional: explicit option then
      `CODECROSSCHECK_API_KEY` then `OPENAI_API_KEY`. Omit the `Authorization`
      header entirely when none is present.
- [x] 1.4 Drop the `gh auth token` fallback and the `models:read` guidance.
- [x] 1.5 Delete `src/clients/githubModels.ts` and repoint its importers.
- [x] 1.6 Add `--base-url` to `src/cli.ts` and pass it through.
- [x] 1.7 Update `test/corpus.test.ts` to the new client and gating.
- [x] 1.8 Update `scripts/selftest.mjs` and `scripts/selftest-openspec.mjs`:
      skip cleanly without a base URL, and remove any undici teardown.
- [x] 1.9 Update README, CONTRIBUTING and `openspec/project.md`.
      — also `docs/ARCHITECTURE.md`, which diagrammed the old client.
- [x] 1.10 Tests: key present sends the header; key absent omits it; missing
      base URL throws a named error; the endpoint is base URL +
      `/chat/completions`. — 11 tests in `test/openaiCompatible.test.ts`.
- [x] 1.11 Red-proof at least one test. — always sending `Bearer ` fails the
      keyless test.
- [x] 1.12 Run lint, typecheck, the full suite, build, and
      `npx openspec validate replace-github-models-with-openai-compatible --strict`.
      — all green, 185 passed / 8 skipped.
