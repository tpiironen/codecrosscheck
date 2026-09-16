# Tasks: add-codecrosscheck

Tasks are grouped by capability. Each group is independently checkable; groups run roughly in the order listed but may overlap.

## A. Core engine (capability: `chat-loop`)

### A1. Package scaffold
- [x] A1.1 Create `package.json` with `"type": "module"`, `"engines": { "node": ">=20" }`, `"bin": { "codecrosscheck": "./dist/cli.js", "ccc": "./dist/cli.js" }`, AND `"contributes": { "chatParticipants": [{ "id": "codecrosscheck", "name": "codecrosscheck" }] }`.
- [x] A1.2 Add runtime deps: `zod`, `undici`, `commander`. Add devDeps: `typescript`, `@types/node`, `@types/vscode`, `vitest`, `@vscode/vsce`.
- [x] A1.3 Create `tsconfig.json` with `strict: true`, `module: "Node16"`, `target: "ES2022"`, `outDir: "dist"`.
- [x] A1.4 Add `.nvmrc` pinning Node 20.
- [x] A1.5 Add `npm run build` (`tsc`) AND `npm test` (`vitest`) scripts.

### A2. ChatClient interface
- [x] A2.1 Create `src/clients/ChatClient.ts` exporting `ChatMessage` AND `ChatClient` interface with `sendStructured<T>(messages, schema): Promise<T>`.

### A3. GitHub Models adapter
- [x] A3.1 Create `src/clients/githubModels.ts` using `undici.request` against `https://models.github.ai/inference/chat/completions`.
- [x] A3.2 Read `GITHUB_TOKEN` from env; throw a descriptive error if missing.
- [x] A3.3 Pass OpenAI `response_format: { type: "json_schema", strict: true }` derived via `zod-to-json-schema`.
- [x] A3.4 On parse failure, retry once with a stricter system message; then fail.

### A4. vscode.lm adapter
- [x] A4.1 Create `src/clients/vscodeLm.ts` using `vscode.lm.selectChatModels({ vendor: "copilot", family })` AND `model.sendRequest(...)`.
- [x] A4.2 Buffer streamed text, parse, validate against zod schema.
- [x] A4.3 On parse failure, retry once with schema repeated; then fail.
- [x] A4.4 Mark `vscode` as a `peerDependency` so the CLI build does not require it.

### A5. Agents
- [x] A5.1 Create `src/agents.ts` with `buildWorker(stage, client)` AND `buildReviewer(stage, client)` reading prompts from `src/prompts/<stage>_<role>.md`.
- [x] A5.2 Export the reviewer verdict zod schema `{ verdict: enum["approve","revise"], issues: array of { severity, where, why, suggestion } }`.

### A6. Loop
- [x] A6.1 Create `src/loop.ts` exporting `reviewLoop(stage, task, { worker, reviewer, maxIters = 3 })`.
- [x] A6.2 Each iteration: worker → reviewer → if `approve` return, else build revision prompt with prior artifact + structured issues.
- [x] A6.3 Return `{ artifact, history, approved, iterations }`.

### A7. Sandbox
- [x] A7.1 Create `src/sandbox.ts` exporting `runSandboxed(code, language, opts)` returning `{ stdout, stderr, exitCode, durationMs }`.
- [x] A7.2 `child_process.spawn` with `cwd` = freshly-created `os.tmpdir()` subdir.
- [x] A7.3 Hard timeout (default 30000 ms); kill process tree on timeout.
- [x] A7.4 Scrub env to allowlist (`PATH`, `LANG`, `TMPDIR`/`TEMP`, `HOME`/`USERPROFILE`).
- [x] A7.5 Best-effort network blocking when `opts.allowNetwork === false`. Document non-adversarial.
- [x] A7.6 Clean tempdir on completion.

### A8. Pipeline
- [x] A8.1 Create `src/pipeline.ts` exporting `runPipeline(task, opts)` chaining PLAN → CODE → EXECUTE.
- [x] A8.2 CODE receives approved plan; EXECUTE feeds sandbox `{ stdout, stderr, exitCode }` to its reviewer as the artifact.
- [x] A8.3 Allow `opts.stages` to restrict stages.

### A9. CLI
- [x] A9.1 Create `src/cli.ts` with `commander`: positional `<task>`, flags `--stages`, `--max-iters`, `--worker-model`, `--reviewer-model`, `--allow-network`, `--timeout-ms`.
- [x] A9.2 JSONL transcript writer appending one event per loop step to `.codecrosscheck/runs/<ISO-timestamp>.jsonl`.
- [x] A9.3 Exit 0 if final stage `approved`, else 1.

## B. Reviewer prompts (capability: `prompts`)

### B1. Plan reviewer prompt
- [x] B1.1 Author `src/prompts/plan_reviewer.md` with persona ("a skeptical senior reviewer"), structured-verdict output contract, AND checklist: scope clarity, missing edge cases, unverified assumptions, dependency ordering, presence of a verification plan.
- [x] B1.2 Include "default to skeptical — no sycophantic approval" directive.
- [x] B1.3 Include "OpenSpec frame" section: when a `change` block is present, enforce alignment with `proposal.md` AND `tasks.md` AND spec deltas.

### B2. Code reviewer prompt
- [x] B2.1 Author `src/prompts/code_reviewer.md` covering correctness vs. plan, **OWASP Top 10** (A01–A10 named individually), boundary-only error handling, no over-engineering, deps pinned, tests present.
- [x] B2.2 "Ground truth is the approved plan" clause — style alone does not justify `revise`.
- [x] B2.3 OpenSpec frame: when a `diff` block is present, every modified file must be in the change's stated impact AND every spec delta must have matching code.

### B3. Execute reviewer prompt
- [x] B3.1 Author `src/prompts/execute_reviewer.md` covering exit code, expected stdout markers, suspicious stderr signals, regressions vs. previous run.
- [x] B3.2 OpenSpec frame: compare execution result against the change's stated verification plan.

### B4. Worker prompts
- [x] B4.1 Author `src/prompts/plan_worker.md` (drafts a structured plan).
- [x] B4.2 Author `src/prompts/code_worker.md` (emits only fenced code blocks).
- [x] B4.3 Author `src/prompts/execute_worker.md` (emits the executable command).

### B5. Test corpus (planted flaws)
- [x] B5.1 `test/corpus/plans/missing-verification/` — plan with no verification section. Reviewer must flag.
- [x] B5.2 `test/corpus/plans/sycophantic-approval/` — plausible plan missing edge cases. Reviewer must NOT approve on first read.
- [x] B5.3 `test/corpus/code/sql-injection/` — string-concat into SQL. Reviewer must flag `severity: high`.
- [x] B5.4 `test/corpus/code/over-engineered/` — three layers of abstraction over a one-liner. Reviewer must flag.
- [x] B5.5 `test/corpus/execute/silent-failure/` — exit 0 + `ERROR` on stderr. Reviewer must flag.
- [x] B5.6 Each fixture has `expected.json` with `severity` AND `whereContains` substring matchers.

## C. VS Code participant (capability: `vscode-extension`)

### C1. Activation
- [x] C1.1 `package.json` `activationEvents`: `onChatParticipant:codecrosscheck`, `onCommand:codecrosscheck.reviewSelection`, `onCommand:codecrosscheck.reviewActiveFile`.
- [x] C1.2 Set `"main": "./dist/extension.js"`.

### C2. Chat participant
- [x] C2.1 Create `src/extension.ts` registering the participant via `vscode.chat.createChatParticipant("codecrosscheck", handler)`.
- [x] C2.2 Handler reads `request.command` (`plan` | `code` | `execute` | empty=all | `openspec-*`) AND settings AND user prompt.
- [x] C2.3 Build worker AND reviewer `vscodeLm` clients using configured families.
- [x] C2.4 Stream loop progress to chat: worker draft → reviewer JSON (collapsible) → separator → next iteration.
- [x] C2.5 Final message includes `approved`, `iterations`, AND a clickable link to the JSONL transcript.
- [x] C2.6 Register slash commands: `plan`, `code`, `execute`, `openspec-init`, `openspec-new`, `openspec-implement`, `openspec-archive`.

### C3. Editor commands
- [x] C3.1 `codecrosscheck.reviewSelection`: run code reviewer ONLY on the selection; show issues in a webview.
- [x] C3.2 `codecrosscheck.reviewActiveFile`: same for the whole file.

### C4. Settings
- [x] C4.1 Contribute `codecrosscheck.workerModel` (string, `openai/gpt-5.4`).
- [x] C4.2 Contribute `codecrosscheck.reviewerModel` (string, `anthropic/claude-opus-4.6`).
- [x] C4.3 Contribute `codecrosscheck.maxIters` (integer, default 3, min 1).
- [x] C4.4 Contribute `codecrosscheck.execute.timeoutMs` (integer, default 30000).
- [x] C4.5 Contribute `codecrosscheck.execute.allowNetwork` (boolean, default `false`).
- [x] C4.6 Each setting has a clear `description` for the Settings UI.

### C5. Sandbox in extension host
- [x] C5.1 `/execute` calls `runSandboxed` directly inside the extension host.
- [x] C5.2 Status-bar indicator while a sandboxed run is in progress.

### C6. Error UX
- [x] C6.1 When `vscode.lm.selectChatModels` returns empty, emit a chat error naming the family AND suggesting a fallback.
- [x] C6.2 Auto-create `.codecrosscheck/runs/` on first run.

## D. Verification (capability: `verification`)

### D1. Test infrastructure
- [x] D1.1 `vitest.config.ts` with `environment: "node"`, `include: ["test/**/*.test.ts"]`.
- [x] D1.2 `test/helpers/FakeChatClient.ts` with a scripted-response queue.

### D2. Loop unit tests
- [x] D2.1 `loop.approve-first` — approve on iteration 1, worker called once.
- [x] D2.2 `loop.revise-then-approve` — iteration-2 worker prompt contains iteration-1 issues.
- [x] D2.3 `loop.iter-cap` — revise×3 with `maxIters: 2` returns `approved: false, iterations: 2`.
- [x] D2.4 `loop.malformed-then-valid` — single retry recovers.
- [x] D2.5 `loop.malformed-twice` — iteration fails with descriptive error.

### D3. Pipeline unit tests
- [x] D3.1 `pipeline.stages-in-order` — PLAN finishes before CODE; CODE before EXECUTE.
- [x] D3.2 `pipeline.code-receives-plan` — CODE worker prompt contains approved plan.
- [x] D3.3 `pipeline.execute-feeds-result` — EXECUTE reviewer is called with `{ stdout, stderr, exitCode }`.

### D4. Sandbox unit tests
- [x] D4.1 `sandbox.timeout` — infinite loop killed within 1500 ms with `timeoutMs: 500`.
- [x] D4.2 `sandbox.tempdir-isolation` — writes go to `os.tmpdir()`, dir removed after return.
- [x] D4.3 `sandbox.env-scrub` — parent's `SECRET_KEY=hunter2` not visible to child.
- [x] D4.4 `sandbox.exit-code` — script `exit 7` propagates as `exitCode: 7`.

### D5. Prompt-contract tests
- [x] D5.1 `prompts.contract` — every `src/prompts/*.md` contains the verdict-schema field names.
- [x] D5.2 `prompts.expected-shape` — every `test/corpus/**/expected.json` is well-formed.

### D6. Live integration test (gated)
- [x] D6.1 `live.github-models` — skipped unless `RUN_LIVE_TESTS=1` AND `GITHUB_TOKEN` are set.
- [x] D6.2 Live test runs a one-iteration PLAN with default model pair AND asserts a structured verdict comes back.

### D7. README
- [x] D7.1 Top-level `README.md`: install, CLI usage, participant usage, settings table, env vars, transcript location, how to enable live tests.

### D8. Cross-platform gate
- [x] D8.1 `npm run verify` = `npm ci` + `npm run build` + `npm test`. Pure Node, no shell scripts.
- [x] D8.2 Provide a template `.github/workflows/ci.yml` (or Azure Pipelines equivalent — pick one, document the other) with a 3-OS matrix; mark template-only.

### D9. Acceptance
- [x] D9.1 `npm run verify` passes on Windows, macOS, AND Linux on a clean checkout.
- [x] D9.2 `RUN_LIVE_TESTS=1 GITHUB_TOKEN=... npm test` passes against live GitHub Models.

## E. Internal distribution (capability: `distribution`)

### E1. Azure DevOps repo
- [x] E1.1 Create the Azure DevOps Repo `CodeCrossCheck`. Push as `main`.
- [x] E1.2 Document the repo URL in `docs/INSTALL.md`.

### E2. Azure Artifacts feeds
- [x] E2.1 Create npm-protocol feed `codecrosscheck-npm`.
- [x] E2.2 Create universal-protocol feed `codecrosscheck-universal`.
- [x] E2.3 Reader for all team members; Contributor for release engineers only.

### E3. Package metadata
- [x] E3.1 Set `package.json` `name` = `@internal/codecrosscheck`, `version` = `0.1.0`.
- [x] E3.2 `publishConfig.registry` = `https://pkgs.dev.azure.com/<org>/_packaging/codecrosscheck-npm/npm/registry/`.
- [x] E3.3 `repository.url` = the Azure DevOps Repo URL.
- [x] E3.4 `files`: `dist/`, `src/prompts/`, `README.md`, `LICENSE`.

### E4. .npmrc template
- [x] E4.1 Add `.npmrc.template` with the scoped registry line AND auth instructions (`vsts-npm-auth` on Windows; `npm config set //pkgs.dev.azure.com/...:_authToken $PAT` cross-platform).

### E5. Release scripts (cross-platform Node ESM)
- [x] E5.1 `scripts/release.mjs`: runs `npm run verify` → `npm publish` → `npx vsce package` → `az artifacts universal publish ...`. All via `child_process.spawn` with arg arrays.
- [x] E5.2 `npm run publish:npm` → `npm publish`.
- [x] E5.3 `npm run publish:vsix` → `node scripts/publish-vsix.mjs`.
- [x] E5.4 `npm run release` → `node scripts/release.mjs`.
- [x] E5.5 Release script refuses if `git status --porcelain` is non-empty OR if branch is not `main`.
- [x] E5.6 Release script hard-fails if resolved registry URL does not match the Azure Artifacts pattern.

### E6. One-liner installer
- [x] E6.1 `bin.codecrosscheck-install` → `dist/install.js`.
- [x] E6.2 `src/install.ts`: detect `code` on PATH → `az artifacts universal download` the `.vsix` → `code --install-extension <path>`.
- [x] E6.3 Document: `npx @internal/codecrosscheck install`.

### E7. Workspace recommendations
- [x] E7.1 `.vscode/extensions.json` with `{ "recommendations": ["internal.codecrosscheck"] }`.
- [x] E7.2 Optional `.devcontainer/devcontainer.json` template installing the `.vsix` on container creation.

### E8. Smoke
- [x] E8.1 Clean machine: configure `.npmrc`, `npm install -g @internal/codecrosscheck`, `codecrosscheck --help` → exit 0.
- [x] E8.2 Clean VS Code: `npx @internal/codecrosscheck install` → reload → `@codecrosscheck` appears in chat suggestions.

## F. OpenSpec integration (capability: `openspec-integration`)

### F1. Change loader
- [x] F1.1 `src/openspec/loader.ts` exporting `loadChange(changeId)` returning `{ proposal, tasks, specDeltas: { capability, body }[] }`.
- [x] F1.2 Throw descriptive error on missing directory or missing `proposal.md`.

### F2. Validator pre-gate
- [x] F2.1 `src/openspec/validate.ts` exporting `validateStrict(changeId)` spawning `openspec validate <changeId> --strict`.
- [x] F2.2 Missing `openspec` CLI returns `{ ok: false, output: "..." }` — does NOT throw.
- [x] F2.3 Pre-gate runs BEFORE every reviewer call. On failure, synthesize a `revise` verdict with one high-severity issue. Zero reviewer tokens consumed.

### F3. Diff slicer
- [x] F3.1 `src/openspec/diff.ts` exporting `getChangeDiff(opts)` running `git diff <mergeBase>...HEAD` AND filtering to files within the change's stated impact.
- [x] F3.2 `chunkPatch(patch, budgetTokens)` splits per file with overlap context (≥ 2 lines).

### F4. CLI flag
- [x] F4.1 Add `--openspec <change-id>` to `src/cli.ts`.
- [x] F4.2 When set: load change → run pre-gate → slice diff → inject `{ change, diff }` into every reviewer prompt.
- [x] F4.3 When omitted: no OpenSpec code paths execute.

### F5. Chat slash commands
- [x] F5.1 Register `openspec-init`, `openspec-new`, `openspec-implement`, `openspec-archive` on the participant.
- [x] F5.2 `openspec-init`: invoke `openspec init` in workspace root via sandbox.
- [x] F5.3 `openspec-new <change-id>`: scaffold `openspec/changes/<change-id>/` with empty `proposal.md` AND `tasks.md`.
- [x] F5.4 `openspec-implement <change-id>`: run full PLAN→CODE→EXECUTE with `--openspec` semantics.
- [x] F5.5 `openspec-archive <change-id>`: invoke `openspec archive <change-id>` via sandbox.

### F6. OpenSpec test corpus
- [x] F6.1 `test/corpus/openspec/good/` — complete change + diff that reviewer must approve.
- [x] F6.2 `test/corpus/openspec/missing-scenario/` — `### Requirement:` with no `#### Scenario:`. Reviewer must flag.
- [x] F6.3 `test/corpus/openspec/scope-creep/` — diff touches a file outside the change's stated impact. Reviewer must flag `severity: high`.
- [x] F6.4 `test/corpus/openspec/wrong-marker/` — `## Added Requirements` (lowercase 'd'). Pre-gate must fail BEFORE reviewer is called.

### F7. Smoke
- [x] F7.1 `node dist/cli.js "..." --openspec add-codecrosscheck` produces a JSONL transcript whose reviewer events include the `change` block.
- [x] F7.2 Manually break a `### Requirement:` to drop its scenario; run with `--openspec`; confirm pre-gate fails AND consumed zero reviewer calls.

## G. Final acceptance

- [x] G1 `openspec validate add-codecrosscheck --strict` passes.
- [x] G2 `npm run verify` passes on Windows, macOS, AND Linux.
- [x] G3 Manual smoke for both surfaces: CLI run AND `@codecrosscheck` participant run, each ending with `approved: true` on a trivial task.
- [x] G4 Self-host check: re-run this very change through `codecrosscheck --openspec add-codecrosscheck` and confirm the reviewer surfaces no critical issues.
