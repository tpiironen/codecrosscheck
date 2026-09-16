# Change: replace-github-models-with-openai-compatible

## Why

The CLI's only backend no longer exists. GitHub Models was **fully retired on
30 July 2026** — playground, model catalog, inference API and BYOK. A live
probe of `https://models.github.ai/inference/chat/completions` returns HTTP 410
`github_models_retirement_brownout`.

Everything built on it is dead: `src/cli.ts` (both clients are
`GithubModelsClient`), `src/clients/githubModels.ts`, and `test/corpus.test.ts`
— the planted-flaw corpus that is the project's only automated evidence that
reviewer models actually detect seeded defects.

The repository is public. It has never been published to npm
(`npm view codecrosscheck` returns 404) and has no forks, so there is no
installed base to protect. What there *is* is a README instructing anyone who
clones it to set `GITHUB_TOKEN` with a `models:read` scope for an endpoint that
returns 410. Leaving that in place is the one option with no defence.

Deleting the CLI would also delete the corpus harness. Re-pointing it costs
little, because `GithubModelsClient` was already an OpenAI-compatible client:
it POSTs `/chat/completions` with `response_format: json_schema`. Only the base
URL and the auth resolution were GitHub-specific.

Being provider-neutral is also a better fit for a public tool than being wired
to one vendor's retired free tier. Azure AI Foundry is GitHub's own suggested
replacement, but OpenAI, vLLM, Ollama and LM Studio all speak the same
protocol.

## What Changes

- `GithubModelsClient` becomes `OpenAiCompatibleClient` in
  `src/clients/openaiCompatible.ts`. `src/clients/githubModels.ts` is removed.
- The base URL is configuration, not a constant: explicit option →
  `CODECROSSCHECK_BASE_URL`. There is no default, because guessing a provider
  is how the current dead endpoint got baked in. An unset base URL is a clear
  error naming the variable.
- The API key is **optional**: explicit option → `CODECROSSCHECK_API_KEY` →
  `OPENAI_API_KEY`. When none is present the `Authorization` header is omitted
  entirely, so local servers that take no key work unmodified.
- The `gh auth token` fallback is removed. It resolved a GitHub credential for
  a non-GitHub endpoint, and a token silently sent to an arbitrary base URL is
  a credential-leak shape.
- `src/cli.ts` gains `--base-url`. `test/corpus.test.ts` and the selftest
  scripts read the same configuration.
- README, CONTRIBUTING and `openspec/project.md` describe bringing your own
  endpoint.

## Impact

- Affected specs: `chat-loop` (the provider adapter requirement names GitHub
  Models and asserts its URL), `openspec-integration` (the selftest harness
  requires `GITHUB_TOKEN`, and also still mandates cleaning up the undici
  global dispatcher — undici was removed earlier in this release).
- Affected code: `src/clients/githubModels.ts` (removed),
  `src/clients/openaiCompatible.ts` (new), `src/cli.ts`, `test/corpus.test.ts`,
  `scripts/selftest*.mjs`.
- **The VS Code extension is unaffected.** It runs on `vscode.lm`, which
  GitHub's retirement notice explicitly describes as a separate, unrelated
  service.
- Breaking for anyone running the CLI from a clone with `GITHUB_TOKEN`. That
  configuration cannot work today, so nothing that functions is being broken.
- The corpus harness stays gated behind `RUN_LIVE_TESTS=1` and now additionally
  requires a base URL, so it remains dormant until someone supplies an endpoint.
