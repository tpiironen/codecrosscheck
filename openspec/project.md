# Project: CodeCrossCheck

CodeCrossCheck is an internal tool that adds a second-model review gate to AI-generated artifacts. A worker LLM produces a plan, code, or execution result; a reviewer LLM (different vendor by default) judges it; on `revise`, the reviewer's structured feedback is fed back to the worker. The loop continues until `approve` or a configured iteration cap.

The same engine ships as both a Node CLI (`codecrosscheck`, alias `ccc`) and a VS Code chat participant (`@codecrosscheck`).

## Stack

- Language: **TypeScript** (≥ 5.9), Node.js **≥ 20**.
- No Python anywhere.
- Runtime deps: `zod` (schema validation + JSON Schema generation), `commander`
  (CLI). HTTP uses the platform `fetch`.
- Dev deps: `vitest`, `eslint` + `typescript-eslint`, `@vscode/vsce`,
  `@types/vscode`, `typescript`, `esbuild`.
- No agent framework dependency — the loop is small enough (~150 LOC) to maintain directly.
- `typescript` is held at `^5.9`: `typescript-eslint` does not yet support
  TS 7.0. Revisit when it supports TS >= 7.1.

## Models

- **In-editor**: VS Code Language Model API (`vscode.lm`) — uses Copilot-tier models with no extra API keys.
- **CLI**: GitHub Models OpenAI-compatible endpoint at `https://models.github.ai/inference`, auth via `GITHUB_TOKEN` with `models:read` scope.
- **Default model pair**: worker `anthropic/claude-opus-5`, reviewer `openai/gpt-5.3-codex`. Cross-vendor by design.
- **Model selection (extension)**: `workerModel` and `reviewerModel` are
  free-text settings. The **CodeCrossCheck: Pick Worker and Reviewer Models**
  command lists the families `vscode.lm` actually offers in the current
  session. The `workerModelOverride` / `reviewerModelOverride` settings are
  deprecated but still take precedence when non-empty.
- **Iteration budget**: default `maxIters` = 6 (configurable per-invocation
  via `max-iters=N` in the prompt or the `codecrosscheck.maxIters` setting).
  Every surface reads this from `src/config.ts`; the manifest default is
  asserted against it in `test/config.test.ts`.

## Audience & distribution

- Internal team only. **Not** published to public npm or the VS Code Marketplace.
- Repo: Azure DevOps Repos, project `codecrosscheck`.
- **Distribution: local-only.** Users clone the repo, run `npm ci && npm run build`,
  package the VSIX with `npx vsce package` and install with
  `code --install-extension`; the CLI is exposed via `npm link` from the
  checkout. No registry / no Azure Artifacts feed is required for ordinary use.
- The `scripts/release.mjs` + `scripts/publish-vsix.mjs` + `.npmrc.template`
  hooks remain in the tree as scaffolding for an *optional* future internal
  Azure Artifacts feed (`codecrosscheck-npm` / `codecrosscheck-universal`),
  but are inert in the default flow.
- CI/CD: manual `npm run release` for now; no pipeline triggers.

## Cross-platform stance

- Must work identically on Windows, macOS, and Linux.
- All automation lives in `package.json` `scripts` — no `.ps1`, no `.sh`.
- Path handling uses `node:path` and `node:url`.
- Pinned via `engines` in `package.json` and `.nvmrc`.

## Naming & identifiers

| Surface | Identifier |
|---|---|
| npm package | `codecrosscheck` |
| CLI binary | `codecrosscheck` (alias `ccc`) |
| VS Code extension id | `tpiironen.codecrosscheck` |
| Chat participant | `@codecrosscheck` |
| Settings namespace | `codecrosscheck.*` |
| Transcript directory | `.codecrosscheck/runs/<timestamp>.jsonl` |

## Conventions

- Reviewer output is **always** structured JSON validated by zod: `{ verdict: "approve"|"revise", issues: { severity, where, why, suggestion }[] }`.
- Structured outputs are non-negotiable for **reviewers** — they are what makes
  the loop deterministic. **Workers** produce documents and reply as plain
  text; wrapping Markdown in a JSON envelope cost tokens and caused escaping
  failures.
- Three pipeline stages, each with its own reviewer prompt: `PLAN`, `CODE`, `EXECUTE`.
- Default `maxIters = 6`. On exhaustion, return the last artifact with `approved: false` rather than throwing.
- A `/review-branch` run ends in exactly one outcome: `approved` (the reviewer
  said so), `rebutted` (the worker talked its way out of every finding — **not**
  an approval), `exhausted`, `cancelled`, or `failed`.
- The `EXECUTE` sandbox uses Node `child_process` with a temp working
  directory, an allowlisted environment, and a hard timeout. It is
  **containment, not a security boundary**: generated code runs as the invoking
  user with full filesystem access and unrestricted network. There is no
  network toggle, because none was ever implemented.

## OpenSpec usage

Every change to this codebase MUST start with an OpenSpec proposal. The bootstrapping change `add-codecrosscheck` introduces all six capabilities at once because the tool is greenfield with no users to migrate. **After that change ships, all subsequent work MUST follow the standard one-capability-per-change pattern** — this matches the surrounding monorepo's style and lets CodeCrossCheck self-host on its own future changes.

Capabilities owned by this project:

- `chat-loop` — engine: clients, agents, loop, sandbox, pipeline, CLI.
- `prompts` — reviewer & worker system prompts, structured-output schema, planted-flaw test corpus.
- `vscode-extension` — chat participant, slash commands, settings, editor commands.
- `verification` — testing strategy and cross-platform gates.
- `distribution` — repo, Azure Artifacts feeds, release workflow.
- `openspec-integration` — the `--openspec` flag, `/openspec-*` slash commands, validator pre-gate, diff slicer.
