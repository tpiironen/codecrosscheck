# Changelog

All notable changes to **CodeCrossCheck** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor bumps may include breaking changes; patch bumps are bug-fix
only).

## [Unreleased]

### Added

- **`/apply-review` build gate.** When the new
  `codecrosscheck.applyReview.buildCommand` setting is non-empty (e.g.
  `dotnet build -nologo`, `npm run build`, `cargo check`),
  `/apply-review` runs it synchronously after writing edits, captures
  the exit code and a tail of combined stdout/stderr, and surfaces a
  pass/fail block in chat. A non-zero exit is reported as a build-gate
  failure with guidance to re-run `/review-branch` with the build
  output as input. Distinct from `applyReview.testCommand`, which
  fire-and-forgets in a terminal. Default timeout is 5 min, tunable via
  `codecrosscheck.applyReview.buildTimeoutMs`. Implemented by
  `runBuildGate()` in `src/applyReview.ts` (unit-tested with a stubbed
  runner).
- **Grounding rule in the review-branch fixer prompt.** The worker is
  now explicitly instructed that every type, method, overload, helper
  class, or extension method referenced in a `newString` must appear
  verbatim in the supplied repository file context, the branch diff, or
  the worker's own prior round for the same file. Worker should
  `Disagree:` with a "missing API" note rather than invent symbols.
  Targets the failure mode where worker hallucinations (e.g. fictional
  helper classes, overloads with the wrong arity) caused
  `/apply-review` to land code that did not compile.

### Changed

- **Default `maxIters` raised from 3 to 6.** Three rounds was too
  tight for complex multi-file reviews — the worker often ran out of
  budget before converging. Six iterations gives the loop more room
  while still bounding cost. Overridable per-invocation with
  `max-iters=N` in the prompt or via
  `codecrosscheck.maxIters` in settings.
- **Model settings now use dropdowns with an override escape hatch.**
  `codecrosscheck.workerModel` and `codecrosscheck.reviewerModel` are
  enum-typed, giving a picker in Settings UI with all Copilot-available
  models (Claude Opus 4.6/4.7, Claude Sonnet 4.5/4.6, Claude Haiku 4.5,
  GPT-5.5/5.4/5.4-mini/5.3-Codex/5.2/4.1/4o, Gemini 3.1 Pro, Gemini 3
  Flash, Grok Code Fast 1). New free-text settings
  `codecrosscheck.workerModelOverride` and
  `codecrosscheck.reviewerModelOverride` let users type any
  `vendor/model-family` string; when non-empty, the override takes
  precedence over the dropdown value (no enum maintenance needed).
- **Default reviewer model changed to `anthropic/claude-opus-4.6`.**
  Aligns with the model already hardcoded in code; dropdown default now
  matches.

### Fixed

- **Content-policy refusals no longer surface as misleading
  `JSON.parse` errors.** When `vscode.lm` returned
  `Sorry, I can't assist with that.` the user previously saw
  `vscode.lm response failed schema "WorkerOutput" twice. First:
  Unexpected token 'S'... Retry: Unexpected token 'e', "text\nSorry"...`,
  which masked the true cause (the model refused) and burned reviewer
  tokens on a doomed retry. `VscodeLmClient.sendStructured` and
  `GithubModelsClient.sendStructured` now inspect each raw response for
  a refusal pattern *before* parsing, throw a new `ModelRefusalError`
  that names the model and quotes the response, and skip the
  schema-reminder retry (it cannot recover a refusal). The two-strike
  fallback error also now includes a 160-char snippet of each raw
  response so schema drift can be diagnosed from chat output alone.
  Tracked under OpenSpec change
  `fix-model-refusal-detection` (`openspec/changes/`).
- **`extractJson` no longer silently unwraps unknown-language fences.**
  The fence regex was `/```(?:json)?\s*([\s\S]*?)```/`, which on a
  ` ```text\nSorry...\n``` ` response stripped the fence and fed
  `text\nSorry...` straight into `JSON.parse`. The regex is now
  `/```(?:json)?\r?\n([\s\S]*?)```/` — only `json` or unlabelled
  fences are unwrapped; everything else falls through to the
  brace-pair fallback. Covered by `test/refusal.test.ts`.
- **`/review-branch` now supports `diff-base=<ref>` in the prompt.**
  Pass any git ref (branch, tag, SHA) to override the default merge-base
  detection — e.g. `@codecrosscheck /review-branch diff-base=empty`.
  Uses two-dot diff syntax (`ref..HEAD`) so orphan branches work.
- **Merge-base resolution falls back to `origin/master`** when
  `origin/main` does not exist, fixing "No diff" errors in repos that
  use `master` as the default branch.

- **`/apply-review` slash command.** Closes the review loop by turning
  the latest `/review-branch` fix proposal into actual file edits. The
  handler locates the newest review transcript, extracts the worker's
  final fix proposal, calls the worker model with a structured-output
  prompt to derive concrete `{path, oldString, newString, why}` edits,
  and applies each one via `vscode.workspace.fs`. Safety: every path is
  validated to resolve under the workspace root, every `oldString` must
  appear exactly once in the target file, and a dry-run mode is
  available. New prompt:
  [`src/prompts/apply_review_worker.md`](src/prompts/apply_review_worker.md).
  New module: [`src/applyReview.ts`](src/applyReview.ts) (pure,
  unit-tested). New settings:
  - `codecrosscheck.applyReview.testCommand` (string, default `""`) —
    optional shell command run in a dedicated terminal after edits.
  - `codecrosscheck.applyReview.dryRun` (boolean, default `false`) —
    plan and print edits without writing.
  Recommended workflow: `/review-branch` → review proposal →
  `/apply-review` → `git diff` → commit → optional `/review-branch`
  re-check.

- **`/apply-review` safety-net repairs.** When the worker's literal
  `oldString` doesn't match the target file verbatim, the handler now
  tries a deterministic sequence of conservative repairs and uses the
  first variant that matches uniquely: CRLF↔LF normalisation (in both
  directions, so an LF-emitting worker patches a CRLF file correctly),
  and unified-diff stripping (drop one leading `-` / `+` / space marker
  per line) for the case where the worker pasted a hunk into the
  string. The `newString` is paired with the same repair so line
  endings and diff shape stay consistent with the surrounding file.
  Helpers: `stripDiffMarkers`, `buildOldStringCandidates`,
  `repairNewStringFor` in [`src/applyReview.ts`](src/applyReview.ts).
- **`/apply-review` create-mode.** A worker edit with `oldString === ""`
  now creates a new file at the resolved path (parent directories are
  created on demand). Existing files are never overwritten via this
  path — the edit is skipped with a clear reason.
- **`/apply-review` debug log.** Every run persists
  `<workspace>/.codecrosscheck/runs/<iso>-apply.json` with the source
  transcript path, iteration, harvested file paths, raw worker `edits`,
  and per-edit `outcomes`. The path is linked from the chat output, so
  zero-edit runs ("worker said it needs more context") are now
  diagnosable instead of silent.
- **`/review-branch` automatic file-context injection.** When the
  reviewer cites a file outside the branch diff (or the worker
  references one in its prior fix proposal), the next fixer iteration
  now reads those files from disk and injects them as a
  `# Repository file context` section in the fixer input (capped at
  60 000 characters). Eliminates the "I need the source of X" dodge:
  the file is right there. URLs, absolute Windows paths, and
  host-prefixed paths are filtered out. Helper: `harvestPathsFromText`
  in [`src/applyReview.ts`](src/applyReview.ts).
- **`/review-branch` worker-disagreement adjudication.** The fixer is
  now allowed to push back on a reviewer finding by writing
  `**Fix:** Disagree: <one-or-two-sentence rebuttal>` for that issue.
  Such rebuttals are parsed out of the final fix proposal and rendered
  at the end of the run as a numbered, blockquoted decision block, so
  the user can see exactly where the worker dissented. Two ways to
  adjudicate: accept the rebuttals by running `/apply-review` (rebutted
  findings produce no edits, so nothing is applied for them); or
  override the worker by re-running `/review-branch` with
  `force-fix-all` anywhere in the prompt — that token (whole-word,
  case-insensitive) appends a `# User override` section that requires
  a concrete fix for every reviewer finding and forbids `Disagree:` in
  that round. Helper: `parseDisagreements` in
  [`src/applyReview.ts`](src/applyReview.ts).

- **`/review-branch` blocked-finding detection.** A complementary
  `parseBlockedFindings` helper flags issue sections where the worker
  dodged producing a concrete patch via prose ("Data I need",
  `(sketch — pending current source)`, "I cannot produce a patch")
  without using the explicit `**Fix:** Disagree:` token. These look
  like fixes at a glance but produce zero edits, so they are now
  surfaced as a separate `🚫 N finding(s) the worker did not produce a
  real patch for` block at the end of the run, naming the likely cause
  (the cited file lives outside the workspace root, so the file-context
  injector could not read it) and pointing at the workspace-switch /
  `force-fix-all` remedies. Issues already captured by
  `parseDisagreements` are excluded to avoid double reporting.
- **`/review-branch` summary discoverability.** The non-converged
  summary now clarifies that residual reviewer findings target the
  **proposal**, not the original branch (so the proposal itself may
  still contain applicable patches), and whenever a fix proposal
  exists — converged or not — the summary points the user at
  `/apply-review`. The manual-only fallback only renders when no
  proposal was produced at all.
- **Reviewer exhaustiveness.**
  [`src/prompts/code_reviewer.md`](src/prompts/code_reviewer.md) now
  requires every finding to be listed (ordered high → low → file/line),
  with no arbitrary numeric cap. Stops the reviewer from self-capping
  at the most-striking 3–5 issues and lets `/review-branch` surface the
  full backlog up front.
- **Complete-round rule for the fixer.**
  [`src/prompts/review_branch_fixer.md`](src/prompts/review_branch_fixer.md)
  now requires each round to be a complete, self-contained proposal:
  any hunk from round N that is still needed MUST be repeated verbatim
  in round N+1, since `/apply-review` consumes only the final round.
  Fixes a real-world drop where a round-2 hunk silently disappeared in
  round-3 because the reviewer re-flagged a sibling finding.
- **Per-invocation `max-iters` prompt token.** `/review-branch` now
  parses `max-iters=N` / `maxiters=N` / `iters=N` from the user prompt
  (whole-token, case-insensitive, range 1..20) and overrides
  `codecrosscheck.maxIters` for that run only.

### Changed

- **`/review-branch` is now a real worker↔reviewer dialogue.** Previously
  the slash command ran the PLAN stage on the diff, which produced
  meta-work (the worker wrote review *plans* while the reviewer critiqued
  the planning). Now iteration 1 is a single CODE-reviewer pass on the
  diff; subsequent iterations have the worker (your Copilot Chat picker
  model) produce a concrete fix proposal addressing every reviewer
  finding, and the reviewer re-judges whether the fixes resolve the prior
  issues. Capped by `codecrosscheck.maxIters` (default 3 = up to 1 review
  + 2 fix rounds). New prompt: [`src/prompts/review_branch_fixer.md`](src/prompts/review_branch_fixer.md).
- **Final summary card.** All chat-participant flows now end with a
  summary: outcome banner (✅ approved / ⚠️ did not converge), total
  iterations, elapsed time, severity counts of any remaining issues, and
  the full final artifact in a `<details>` block. Replaces the bare
  `Done. approved=false` line that left users without closure when the
  iteration cap was hit.
- **Live agent-status streaming.** `loop.ts` now exposes
  `onIterationStart` / `onWorkerStart` / `onWorkerEnd` /
  `onReviewerStart` / `onReviewerEnd` callbacks; `pipeline.ts` fires
  events live (post-stage batching removed). The chat UI shows
  per-iteration progress indicators, severity-icon issue lists, and
  truncated worker artifacts as they arrive instead of dumping
  everything at the end.

### Added

- **`ChatClient.sendText(messages)`** — plain-text path with no JSON
  parsing or schema retry. Implemented for both `VscodeLmClient` and
  `GithubModelsClient`. Used by `buildWorkerWithPrompt` so workers
  producing rich Markdown (e.g. fix proposals containing C# code blocks)
  don't have to round-trip through a `{"artifact": "..."}` envelope that
  large-context models tend to drop.
- **`buildWorkerWithPrompt(system, client)` and `loadPromptByName(name)`**
  in `src/agents.ts` — lets callers build workers outside the Stage
  pipeline with arbitrary system prompts. Used by `/review-branch`.
- **`.vscode/launch.json` and `.vscode/tasks.json`** for one-key F5
  Extension Development Host launch with auto-build.

### Fixed

- **JSON-envelope failures on large fix proposals.** With a 300 KB+ diff
  and a multi-section Markdown response, the worker model would emit raw
  Markdown instead of the schema-required JSON wrapper, causing
  `vscode.lm response failed schema "WorkerOutput" twice` and aborting
  the iteration. Workers building fix proposals now use `sendText`.

### Configuration

- Default `codecrosscheck.reviewerModel` changed from
  `anthropic/claude-opus-4.6` to `openai/gpt-5.4` (matches `--reviewer-model`
  CLI default).

## [0.2.0] — 2026-04-28

OpenSpec change: [`add-chat-picker-and-delegation`](openspec/changes/add-chat-picker-and-delegation/proposal.md).

### Added

- **VS Code: chat-picker worker.** New setting
  `codecrosscheck.useChatPickerWorker` (boolean, default `true`). When
  enabled, `@codecrosscheck` uses the model selected in the Copilot Chat
  model picker as the worker. The reviewer always stays on
  `codecrosscheck.reviewerModel` to preserve the cross-vendor invariant. A
  warning is streamed to chat if both resolve to the same model id.
- **VS Code: `/review-branch` slash command.** Attaches the current branch
  diff (vs `origin/main` merge-base, falling back to `HEAD`) and runs the
  PLAN stage as a code review.
- **CLI: `--diff` and `--diff-base <ref>` flags.** Append the current branch
  diff to the task prompt. Empty diffs warn on stderr and proceed; failed
  computation exits non-zero.
- **Delegation skill (`codecrosscheck-delegate`).** Teaches Copilot's default
  agent to delegate review and OpenSpec-implementation requests to
  `@codecrosscheck` instead of self-reviewing. Shipped via:
  - **Bundle:** `scripts/copy-assets.mjs` copies `.github/skills/` into
    `dist/assets/skills/` so the skill rides inside the VSIX and the npm
    tarball.
  - **VS Code:** new Command Palette entry
    `CodeCrossCheck: Install Delegation Skill` with a Workspace / User
    QuickPick.
  - **CLI:** `npx codecrosscheck install skill [--user]` subcommand.
  - Both installers refuse to overwrite without explicit confirmation.
- **Self-tests:** `npm run selftest:openspec` runs an end-to-end PLAN
  against the new `add-sha256-cli` fixture under `openspec/changes/`,
  exercising the validator pre-gate and OpenSpec frame against live
  GitHub Models. The existing `npm run selftest` covers the non-OpenSpec
  path.

### Changed

- **Default model pair bumped:** worker `openai/gpt-5.4` (was `openai/gpt-5`),
  reviewer `anthropic/claude-opus-4.6` (was `anthropic/claude-opus-4.5`).
  Applies to CLI defaults and to `codecrosscheck.workerModel` /
  `codecrosscheck.reviewerModel` setting defaults.
- **README** documents `--diff`, `--diff-base`, the chat-picker setting,
  `/review-branch`, the delegation-skill install paths, and the new
  selftests.

### Security

- **`validateStrict` shell-injection guard.** `src/openspec/validate.ts`
  now rejects `changeId` values that do not match `^[A-Za-z0-9._-]+$`
  before invoking `child_process.spawn`. This closes the seam introduced
  by the Windows-required `shell: true` (needed for `openspec.cmd` shims
  after Node 22's CVE-2024-27980 hardening).

### Fixed

- Selftest scripts now close `undici.getGlobalDispatcher()` on completion
  so the process terminates promptly on Windows instead of hanging on
  keep-alive sockets.

## [0.1.0] — 2026-04-26

Initial internal release. OpenSpec change:
[`add-codecrosscheck`](openspec/changes/add-codecrosscheck/proposal.md).

### Added

- **Core engine (`chat-loop`).** `ChatClient` interface with two adapters:
  GitHub Models (CLI, via `undici` + OpenAI `response_format` JSON-schema
  strict) and `vscode.lm` (VS Code extension, via Copilot model selection).
  Worker → reviewer iteration loop with zod-validated structured verdicts
  (`{ verdict: "approve"|"revise", issues: { severity, where, why,
  suggestion }[] }`), iteration cap, single malformed-response retry,
  and per-iteration revision prompts that include prior structured issues.
- **Pipeline.** Three-stage `PLAN → CODE → EXECUTE` orchestration. CODE
  receives the approved plan; EXECUTE feeds sandbox `{ stdout, stderr,
  exitCode }` to its reviewer.
- **Sandbox.** `child_process.spawn`-based runner with fresh tmpdir,
  env allowlist (`PATH`, `LANG`, `TMPDIR`/`TEMP`, `HOME`/`USERPROFILE`),
  hard timeout (default 30 s), best-effort network deny via
  `NO_PROXY=*`, and tmpdir cleanup.
- **Reviewer prompts (`prompts`).** PLAN / CODE / EXECUTE reviewer system
  prompts. Code reviewer names OWASP A01–A10 explicitly, enforces
  boundary-only error handling and no-over-engineering. Worker prompts
  for each stage. Planted-flaw test corpus
  (`test/corpus/{plans,code,execute}/`) with `expected.json` matchers.
- **Node CLI (`codecrosscheck` / `ccc`).** `commander` entry, JSONL
  transcript writer (`.codecrosscheck/runs/<ISO>.jsonl`), exit 0 on
  approve / 1 on cap-without-approval. Flags: `--stages`, `--max-iters`,
  `--worker-model`, `--reviewer-model`, `--allow-network`, `--timeout-ms`,
  `--openspec <id>`.
- **VS Code chat participant (`vscode-extension`).**
  `@codecrosscheck` registered via `vscode.chat.createChatParticipant`.
  Slash commands `/plan`, `/code`, `/execute`, `/openspec-init`,
  `/openspec-new`, `/openspec-implement`, `/openspec-archive`. Editor
  Command Palette commands `Review Selection` and `Review Active File`.
  Settings under `codecrosscheck.*`.
- **Verification (`verification`).** Vitest unit suites for loop, pipeline,
  sandbox, prompt-contract checks. Deterministic `FakeChatClient` helper.
  Live integration test gated behind `RUN_LIVE_TESTS=1` + `GITHUB_TOKEN`.
  Cross-platform `npm run verify` script.
- **Distribution (`distribution`).** Azure DevOps Repos hosting plan, two
  Azure Artifacts feeds (`codecrosscheck-npm`, `codecrosscheck-universal`),
  manual `npm run release`, one-liner installer
  (`npx @internal/codecrosscheck install`). Release script refuses if
  tree is dirty, branch is not `main`, or registry URL doesn't match the
  Azure Artifacts pattern. `.npmrc.template`, `.vscode/extensions.json`,
  optional devcontainer template.
- **OpenSpec integration (`openspec-integration`).** Opt-in
  `--openspec <change-id>` mode injects a change frame (proposal +
  tasks + spec deltas) into reviewer prompts. Deterministic
  `openspec validate --strict` pre-gate runs before each reviewer call;
  on failure, a synthesized verdict short-circuits the loop with zero
  reviewer tokens spent. Diff-only context via `git diff` against merge
  base, chunked per-file.

### Default model pair

- Worker: `openai/gpt-5`
- Reviewer: `anthropic/claude-opus-4.5`

[Unreleased]: ./CHANGELOG.md
[0.2.0]: ./CHANGELOG.md#020--2026-04-28
[0.1.0]: ./CHANGELOG.md#010--2026-04-26
