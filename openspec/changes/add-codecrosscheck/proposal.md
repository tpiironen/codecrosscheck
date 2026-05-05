# Add CodeCrossCheck

## Why

The team currently has no second-model gate on AI-generated artifacts; everything ships from a single model, which produces shared blind spots and undetected drift between intent and output. CodeCrossCheck introduces a small, framework-free TypeScript loop where a **worker** model produces work and a **reviewer** model from a different vendor judges it, iterating until approved or until an iteration cap is hit. The same engine is exposed as a Node CLI and as a VS Code chat participant, so it works equally well in terminals and inside Copilot Chat.

This single change establishes the entire tool — engine, prompts, VS Code surface, test floor, internal distribution, and OpenSpec-aware mode — because there are no users yet and nothing to migrate. Splitting into multiple changes only adds value once the tool exists and is deployed; later changes (after this one ships) will follow the standard one-capability-per-change pattern that the rest of the monorepo uses.

## What Changes

This change introduces six **new** capabilities in one step:

- `chat-loop` — iteration semantics, two `ChatClient` adapters (GitHub Models + `vscode.lm`), staged pipeline (`PLAN → CODE → EXECUTE`), sandboxed execution, JSONL transcripts, the `codecrosscheck` Node CLI.
- `prompts` — three reviewer system prompts (PLAN / CODE / EXECUTE), three worker system prompts, planted-flaw test corpus. Code reviewer checklist explicitly covers OWASP Top 10, boundary-only error handling, and no-over-engineering.
- `vscode-extension` — `@codecrosscheck` chat participant; slash commands `/plan`, `/code`, `/execute`, `/openspec-init|new|implement|archive`; Command Palette commands `Review Selection` and `Review Active File`; settings under `codecrosscheck.*`.
- `verification` — vitest unit suites for loop, pipeline, sandbox, and prompt-contract checks; deterministic `FakeChatClient`; gated live integration test (`RUN_LIVE_TESTS=1`); top-level README; cross-platform `npm run verify` script.
- `distribution` — Azure DevOps Repos hosting, two Azure Artifacts feeds (`codecrosscheck-npm` and `codecrosscheck-universal`), manual `npm run release`, one-liner installer (`npx @internal/codecrosscheck install`). No public npm. No VS Code Marketplace.
- `openspec-integration` — opt-in `--openspec <change-id>` flag; deterministic `openspec validate --strict` pre-gate that runs before each reviewer call and short-circuits with a synthesized verdict on validation failure (zero reviewer tokens spent); diff-only context via `git diff` against merge base; OpenSpec test corpus.

Default model pair: worker `openai/gpt-5.4`, reviewer `anthropic/claude-opus-4.6`. Reviewer output is a zod-validated JSON verdict: `{ verdict: "approve"|"revise", issues: { severity, where, why, suggestion }[] }`.

## Impact

- **Affected specs**: six new capabilities (`chat-loop`, `prompts`, `vscode-extension`, `verification`, `distribution`, `openspec-integration`). No existing specs modified — there are none yet.
- **Affected code**: the entire repository — `package.json`, `tsconfig.json`, `src/**`, `test/**`, `scripts/**`, `docs/**`, `README.md`, `.npmrc.template`, `.vscode/extensions.json`, optional `.devcontainer/`.
- **Risk surface**:
  - GitHub Models endpoint shape OR `vscode.lm` shape changes — isolated behind the `ChatClient` interface.
  - `vscode.lm` quota exhaustion surfaces as user-visible failures — handled with actionable error messages.
  - Large diffs in OpenSpec mode could blow the reviewer context window — chunked per-file with overlap.
  - Accidental publish to public npm — release script hard-fails if registry doesn't match the Azure Artifacts URL pattern.
- **Out of scope**: automated CI publish (manual `npm run release` only); public marketplace listing; rewriting the `openspec` CLI itself; non-standard OpenSpec workflows.
- **Self-hosting**: from this change onward, all subsequent changes in this repo SHOULD use CodeCrossCheck (`--openspec <change-id>`) for plan and code review.
