# Changelog

All notable changes to **CodeCrossCheck** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: minor bumps may include breaking changes; patch bumps are bug-fix
only).

Each release heading includes both a SemVer tag **and** the date it shipped
(e.g. `## [0.3.1] — 2026-05-27`), so this file can be read as either a version
history or a timeline. On every version bump, rename `## [Unreleased]` to
`## [<new-version>] — <today>` and add a fresh empty `## [Unreleased]` above it.

## [Unreleased]

## [0.5.0] — 2026-09-16

OpenSpec changes (all archived under `openspec/changes/archive/2026-09-16-*`):
[`fix-edit-application-and-verdict-honesty`](openspec/changes/archive/2026-09-16-fix-edit-application-and-verdict-honesty/proposal.md),
[`harden-trust-and-sandbox`](openspec/changes/archive/2026-09-16-harden-trust-and-sandbox/proposal.md),
[`add-cancellation-and-worktree-diff`](openspec/changes/archive/2026-09-16-add-cancellation-and-worktree-diff/proposal.md),
[`modernize-chat-surface`](openspec/changes/archive/2026-09-16-modernize-chat-surface/proposal.md),
[`modernize-toolchain`](openspec/changes/archive/2026-09-16-modernize-toolchain/proposal.md),
[`update-default-model-pair`](openspec/changes/archive/2026-09-16-update-default-model-pair/proposal.md),
[`raise-review-branch-diff-budget`](openspec/changes/archive/2026-09-16-raise-review-branch-diff-budget/proposal.md),
[`trim-rereview-diff-context`](openspec/changes/archive/2026-09-16-trim-rereview-diff-context/proposal.md),
[`flush-transcript-before-return`](openspec/changes/archive/2026-09-16-flush-transcript-before-return/proposal.md),
[`pin-vscode-api-floor`](openspec/changes/archive/2026-09-16-pin-vscode-api-floor/proposal.md),
[`add-finding-triage`](openspec/changes/archive/2026-09-16-add-finding-triage/proposal.md),
[`replace-github-models-with-openai-compatible`](openspec/changes/archive/2026-09-16-replace-github-models-with-openai-compatible/proposal.md),
[`fix-referenced-path-normalisation`](openspec/changes/archive/2026-09-16-fix-referenced-path-normalisation/proposal.md),
[`budget-file-context-per-file`](openspec/changes/archive/2026-09-16-budget-file-context-per-file/proposal.md),
[`replace-context-harvest-with-tools`](openspec/changes/archive/2026-09-16-replace-context-harvest-with-tools/proposal.md),
[`report-applied-edits-as-unsaved`](openspec/changes/archive/2026-09-16-report-applied-edits-as-unsaved/proposal.md).

**Known gap:** the planted-flaw corpus comparison for
`replace-context-harvest-with-tools` (task E2) has not been run. It needs
`RUN_LIVE_TESTS=1` and a configured model endpoint. Nothing in this release
should be read as evidence about the corpus pass rate.

### Added

- **Agents can now ask for files instead of being handed a guess.** `ChatClient`
  supports a tool-call round trip, implemented identically by the in-editor
  (`vscode.lm`) and OpenAI-compatible (CLI) transports, and the triager and
  fixer are given a read-only workspace toolset: `read_file`,
  `search_workspace`, `list_directory`. Every path is confined to the workspace
  root by `resolveSafePath`, screened by a denylist (VCS metadata, build
  output, dependency trees, `.env` / `*.pem` / `id_rsa` and similar), and then
  by `git check-ignore` when the workspace is a repository. The toolset exposes
  no operation that writes, creates or deletes. Each loop is bounded by
  `codecrosscheck.tools.maxCalls` (default 24) and
  `codecrosscheck.tools.deadlineMs` (default 180 000); on exhaustion the client
  withdraws the tools, tells the model, and takes one final answer. Every call
  is streamed to the user and recorded in the transcript as a `tool-call`
  event.

  This closes the defect that motivated the change. On the 2026-09-16 dogfood
  run the triager needed `src/applyReview.ts` to judge a finding that cited
  only `src/extension.ts`, could not ask for it, and returned `uncertain`;
  nothing was fixed. Both pre-computed alternatives were measured and rejected:
  symbol-directed harvesting would have found nothing (every identifier the
  finding named is defined in `extension.ts` itself), and one-hop import
  closure would have pulled 121 671 chars against a 60 000 budget, halving both
  files that mattered to make room for eight nobody asked about. The need was
  discovered *during reasoning* — only letting the model ask can supply it.

### Changed

- **The fixer returns structured edits; `/apply-review` no longer calls a
  model.** `/review-branch` now produces a schema-validated `FixProposal`: one
  entry per finding with a `status` (`fixed` / `disagree` / `unaddressed`), an
  explanation, and exact `oldString` / `newString` edits. The Markdown shown in
  chat and sent to the reviewer for re-review is derived from that structure,
  so the prose and the edits cannot disagree. `/apply-review` reads those edits
  from the transcript and applies them — it is now purely the user-confirmation
  checkpoint, with dry-run, path validation and the build gate intact.
- **Edits repair line endings and nothing else.** The unified-diff-marker
  stripping and the general repair-candidate sequence are gone: with the
  Markdown round trip removed, a near-miss there means the edit is wrong and
  repairing it would hide that. Line-ending pairing stays, because dogfooding
  showed the model reads a CRLF file through `read_file` and emits LF in its
  JSON anyway — 11 of 12 edits were skipped before this was fixed. Any other
  mismatch is skipped with a reason and the file left untouched.
- **Worker push-back and dodges are structural, not textual.** A rebuttal is
  `status: "disagree"` rather than the string `**Fix:** Disagree:`, and a
  finding the worker could not patch is `status: "unaddressed"` rather than a
  regex match on `**Data I need` or `pending current source` — phrases that
  occur in ordinary prose.
- `scripts/copy-assets.mjs` clears the destination before copying. `cpSync`
  merges, so a deleted prompt survived in `dist/` and shipped in the VSIX.
- **`/apply-review` no longer calls an unsaved buffer "applied".** Edits are
  committed through `vscode.workspace.applyEdit` so one undo reverts the batch,
  which means nothing reaches disk until the files are saved — but the report
  said `✅ applied` and the debug log agreed. During this release's own
  dogfooding that read as a broken apply path twice in one hour, `git status`
  showing a clean tree after a run that claimed 12 edits. Outcomes now
  distinguish `written` from `unsaved`, the summary says plainly that nothing
  is on disk yet, and it offers a Save button.

### Removed

- `harvestPathsFromText`, `resolveReferencedPath`, `normalizeReferencedPath`,
  `buildFileInventory`, `allocateBudget`, `parseReferencedFiles`,
  `composeApplyInput`, `deriveEdits`, `parseDisagreements`,
  `parseBlockedFindings`, `buildOldStringCandidates`, `repairNewStringFor`,
  `stripDiffMarkers`, `buildWorkerWithPrompt`, `ApplyReviewSchema`, and
  `src/prompts/apply_review_worker.md`. Every one of them compensated for the
  model not being able to fetch a file or carry an exact string.
- The `# Repository file context` block and its 60 000-character cap.

### Fixed

- **A single large file could starve every other file out of the review
  context.** The `# Repository file context` block is capped at 60 000
  characters, and the cap was applied as one prefix slice over the
  concatenated files. Measured on a live run: `src/extension.ts` is 63 430
  chars, so it exceeded the whole budget alone and was cut mid-function, and
  `src/applyReview.ts` (29 414 chars) — cited by the second finding — never
  entered the block at all. The triager returned `uncertain` for both findings
  and said exactly why: the file was "truncated mid-function" and the body of
  the cited function "was not provided". Outcome `defended`, nothing fixed, one
  model call spent reaching a non-answer.

  The budget is now allocated per cited file, smallest first, so a file shorter
  than its equal share is included whole and leaves the remainder to the
  others. No cited file is dropped. A file that still does not fit is truncated
  individually, labelled `PARTIAL` in its own header, and retains its head *and*
  tail with the elision marked — a finding may cite a symbol anywhere in the
  file, and the old head-only cut systematically hid the end.

### Fixed

- **`/apply-review` silently produced zero edits when a path directive named a
  symbol.** Workers commonly write `// path: src/extension.ts:someFunction`,
  and reviewers cite locations with call syntax such as
  `src/extension.ts:workspaceEditHost().commit`.
  `normalizeReferencedPath` stripped backticks, parentheticals and `:line`
  suffixes but not `:symbol`, so the malformed path reached
  `buildFileInventory` — which found it did not exist and offered it to the
  worker as *a file to create*. Six such references became six invitations to
  create phantom files, `missing` stayed empty, the existing "unreadable
  path(s)" warning never fired, and the worker was never shown a line of real
  source. It correctly returned no edits.

  Symbol suffixes are now stripped, including symbols written with call syntax,
  a reference that cannot denote a workspace
  file is reported as unresolvable rather than offered for creation, and the
  handler says so when the inventory yields no source at all. Observed live:
  the same transcript that produced 0 edits now produces 6.

### Removed

- **`GithubModelsClient` and the GitHub Models backend.** GitHub Models was
  fully retired on 2026-07-30; the endpoint returns HTTP 410. Every CLI
  invocation had been broken since, and the README still instructed new users
  to set `GITHUB_TOKEN` with a `models:read` scope for it.

- **The `gh auth token` credential fallback.** It resolved a GitHub credential
  for what is now an arbitrary configured base URL — a credential-leak shape.

### Added

- **`OpenAiCompatibleClient`: bring your own endpoint.** The CLI now talks to
  any OpenAI-compatible `/chat/completions` API — OpenAI, Azure AI Foundry,
  vLLM, Ollama, LM Studio. Configure with `CODECROSSCHECK_BASE_URL` or
  `--base-url`. There is deliberately **no default provider**: hard-coding one
  is exactly how the CLI came to depend on a service that was switched off.
  The API key is optional (`CODECROSSCHECK_API_KEY` or `OPENAI_API_KEY`); when
  unset the `Authorization` header is omitted entirely, so keyless local
  servers work unmodified.

  The VS Code extension is unaffected — it runs on `vscode.lm`, which GitHub's
  retirement notice describes as a separate, unrelated service.

### Added

- **`/review-branch` now triages findings before drafting fixes.** The worker
  is asked, per finding, whether the finding is real — as a schema-validated
  judgement (`confirmed` / `rejected` / `uncertain`) with mandatory evidence in
  both directions — before any fix is written. Only confirmed findings reach
  the fixer; `uncertain` never does, so a guess cannot become a code edit.
  `force-fix-all` bypasses triage so you can still overrule the worker.

  This exists because of a real failure. In the run recorded at
  `2026-09-14T12-25-09-360Z.jsonl`, the reviewer claimed
  `WorkspaceEdit.createFile(uri, { contents })` does not accept a `contents`
  payload. It does, and the VS Code typings say so. The worker did not push
  back: it restated the false premise, rewrote `workspaceEditHost().commit`
  with an extra `fs.stat` per file, and added the comment "`createFile` only
  creates the file; the content must be a separate text edit". The reviewer
  approved it. Applying that proposal would have replaced working code with
  more complex code and recorded a falsehood in a comment. A worker instructed
  to fix N issues fixes N issues, including the ones that are wrong.

- **New `defended` review outcome**, for a run where no remaining finding
  survived triage. That is an assessment of your code, not an approval of a fix
  proposal, and the two are now reported differently.

### Changed

- **Minimum VS Code is now 1.95.0** (was 1.93.0), and `@types/vscode` is pinned
  with a tilde range. `engines.vscode` declared `^1.93.0` while `@types/vscode`
  used a caret and resolved to **1.116.0**, so typecheck validated against an
  API surface 23 minor versions newer than the advertised range. Pinning to
  1.93 produced four errors, all `ChatRequest.model`, which only exists from
  1.95.0. Since `useChatPickerWorker` defaults to `true`, the picker-as-worker
  feature silently did nothing on 1.93 and 1.94. The floor is now enforced by
  the compiler instead of assumed.

### Fixed

- **`/apply-review` could fail to find a review that had just succeeded.**
  Transcript writes were queued and the handler returned without waiting, so
  the terminal `review-branch-done` event was not guaranteed to be on disk —
  including when `/apply-review` was launched from the button the review itself
  renders. Handlers now flush before returning. Append failures were also
  discarded by a bare `.catch(() => undefined)`, making a dropped event
  indistinguishable from a stale build; the first failure is now reported and
  surfaced in chat as a warning, without failing a run that produced a verdict.
  Found by the tool reviewing its own branch.

- **`/review-branch` no longer resends the whole branch diff on every
  re-review.** Each iteration previously carried the full diff to both the
  fixer and the reviewer. Measured on this repository: a two-iteration run made
  three calls that each carried 178,575 chars — 535,725 chars of duplicated
  diff, roughly 150,000 input tokens, to produce two findings. The re-review
  pass now sends only the files its own prior findings cited, reusing the path
  set already harvested for the fixer's file context. The prompt states how
  many files were omitted so the reviewer is not misled about the branch's
  size, and the counts are recorded in the transcript so the saving can be
  checked rather than taken on trust. When no cited path matches the diff, the
  full diff is sent unchanged — scoping never empties the reviewer's context.
  The initial review pass is untouched and still sees everything.

- **`codecrosscheck.reviewBranch.maxDiffChars` now defaults to `1100000`**
  (was `200000`). The old cap aborted `/review-branch` on ordinary working
  trees before any model call — a 65-file change set on this repository
  measures over 500,000 chars — so the first thing a user had to do was find
  and raise the setting. The char cap was always a cheap pre-filter; the
  accurate gate is the token preflight that follows it, which asks the
  reviewer model for its own `maxInputTokens`. Note the trade-off: at this
  size the cap no longer catches anything the preflight would not, and the
  preflight is best-effort — it permits the call when a model reports no
  `maxInputTokens`. Lower the setting to restore the stricter behaviour.

- **Default model pair is now worker `anthropic/claude-opus-5`, reviewer
  `openai/gpt-5.3-codex`** (was worker `openai/gpt-5.4`, reviewer
  `anthropic/claude-opus-4.6`). The pair remains cross-vendor; the direction
  flips, so the OpenAI model is now the judge. Note that
  `codecrosscheck.useChatPickerWorker` defaults to `true`, so in the chat
  participant the worker follows the Copilot Chat picker and
  `codecrosscheck.workerModel` only applies as a fallback. The reviewer is
  always taken from `codecrosscheck.reviewerModel`.

### Fixed

- **The CLI shipped a same-model pair.** `--worker-model` and
  `--reviewer-model` both defaulted to `openai/gpt-5.4`, so a plain
  `codecrosscheck "..."` invocation ran the worker and the reviewer on one
  model — defeating the cross-vendor premise and contradicting the `chat-loop`
  requirement that the reviewer default not share the worker's family. The two
  flags now default to different vendors. This restores spec conformance but
  does not make the CLI usable: its backend, GitHub Models, was retired by
  GitHub on 2026-07-30 and the endpoint returns HTTP 410.

- **`/apply-review` corrupted any replacement containing `$&`, `` $` ``, `$'`
  or `$$`.** `applyEdit` wrote the new content with
  `original.replace(matchedOld, repairedNew)`; `String.prototype.replace` runs
  `GetSubstitution` on the replacement even for a string search value, so those
  patterns were expanded instead of written literally — and the edit was still
  reported as `applied`. Replacements are now spliced by index. Common triggers
  were Makefile/shell `$$`, bash `$'…'`, and source that itself calls
  `.replace(…, "$&")`.
- **`/review-branch` claimed the reviewer approved when it had not.** When the
  worker rebutted every outstanding finding, `filterRejectedIssues` flipped the
  verdict to `approve` and the summary printed "Approved — reviewer is
  satisfied". The reviewer never approved; the worker suppressed the findings.
  There is now an explicit outcome (`approved`, `rebutted`, `exhausted`,
  `cancelled`, `failed`), and `rebutted` is rendered as a stalled disagreement
  pointing at the rebuttal list.
- **`/review-branch` did not review uncommitted work.** `getChangeDiff` ran
  `git diff <base>...HEAD`, so staged and unstaged edits were invisible even
  though the documented workflow says to review the working tree. The default
  comparison now includes the working tree; pass `committed-only` for the old
  behaviour. Untracked files stay excluded. The chat header now names the
  comparison that was made.
- **Stopping a chat response did not stop the loop.** The request
  `CancellationToken` was discarded and `VscodeLmClient` created a token source
  nobody could trigger and nobody disposed. Cancellation is now threaded
  through the clients, `reviewLoop` and `runPipeline`.
- The structured-output retry now shows the model its own failed response and
  the validation error. The previous reminder named a schema without stating
  it, and fell back to the sentence "the previously stated structured-verdict
  schema" for every schema in the codebase.
- Transcript discovery matched the substring `"review-branch-done"` anywhere in
  a file, so a stored worker artifact quoting the event name read as a
  completed run. It now matches a parsed terminating event near the tail.
- Files attached to a chat request were silently discarded; they are now read
  into the prompt, listed in the response, and counted against the diff budget.

### Security

- `codecrosscheck.applyReview.buildCommand` and `.testCommand` are now
  `scope: "machine"`. They previously had no scope, so a repository's
  `.vscode/settings.json` could choose the command `/apply-review` executes.
- The manifest now declares `capabilities.untrustedWorkspaces` explicitly
  instead of relying on the absence of the field, and `/apply-review` refuses
  to run build or test commands unless the workspace is trusted.
- `.codecrosscheck/` now self-ignores in git on creation, and transcripts are
  pruned to `codecrosscheck.reviewBranch.keepTranscripts` (default 50).
  Transcripts contain full source diffs.
- The verdict webview declares `localResourceRoots: []` and a
  `default-src 'none'` Content Security Policy.

### Changed

- **`/apply-review` applies its batch through `vscode.workspace.applyEdit`**, so
  a run is a single undo step and files with unsaved changes are edited in the
  document rather than overwritten on disk. Edits are also computed in full
  before anything is written, so a mid-batch failure leaves the tree untouched.
- **Worker prompts no longer use a `{"artifact": "…"}` JSON envelope.** Workers
  produce documents and now reply with plain text; reviewers remain structured
  and zod-validated.
- **The CODE reviewer checklist moved from OWASP Top 10:2021 to Top 10:2025**
  (verified against owasp.org — 2021 is now listed as a previous version). A03
  is Software Supply Chain Failures, A10 is Mishandling of Exceptional
  Conditions, and SSRF is no longer a standalone category, so an explicit note
  keeps it covered. The edition is read back out of the prompt and recorded in
  the transcript, so a past review can be audited against the list that was
  actually applied.
- All settings are resolved through `src/config.ts` with one declared default
  each, asserted against the manifest by `test/config.test.ts`. This fixes the
  reviewer default falling back to the worker's vendor in `/review-branch` and
  the `maxIters` default disagreeing across manifest, code, CLI and docs.
- `codecrosscheck.workerModel` / `reviewerModel` are free text instead of a
  hand-maintained enum of 15 families. New command **CodeCrossCheck: Pick
  Worker and Reviewer Models** lists what `vscode.lm` actually offers.
  `workerModelOverride` / `reviewerModelOverride` are deprecated but honoured.
- Chat handlers return a `ChatResult` with `errorDetails`, offer followups, and
  expose the recommended next step as a button.
- Compiler strictness raised (`noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`); the four `void x;` suppression statements are
  gone, and `test/hygiene.test.ts` keeps them gone.

### Added

- ESLint with `typescript-eslint` (`npm run lint`) and a type-check gate that
  covers `test/` for the first time (`npm run typecheck`). CI runs both, and
  now also packages a VSIX.
- The planted-flaw reviewer corpus runs as a scheduled/dispatchable CI job, and
  states its reason when skipped instead of looking like a passing gate.
- `codecrosscheck.reviewBranch.keepTranscripts` setting.

### Removed

- **`codecrosscheck.execute.allowNetwork` and the CLI `--allow-network` flag.**
  The option was implemented as `NO_PROXY=*`, which tells clients to *bypass* a
  proxy and denies nothing. Rather than keep a control that does not work, it
  is removed and the sandbox's actual containment (temp cwd, allowlisted
  environment, hard timeout) is documented plainly.
- Dependencies `undici` and `zod-to-json-schema`. zod 4 generates JSON Schema
  natively and Node 20 has a global `fetch`; dropping `undici` also removed the
  `closeUndici()` libuv shutdown workaround in the CLI.

### Notes

- `typescript` stays on `^5.9.3`: `typescript-eslint` does not support TS 7.0
  ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
  See the deferral note in the `modernize-toolchain` proposal.

## [0.4.0] — 2026-05-29

### Changed

- **First public release.** Repository moved to GitHub
  ([`tpiironen/codecrosscheck`](https://github.com/tpiironen/codecrosscheck)),
  licensed MIT, default branch renamed `master` → `main`. Added
  `LICENSE`, [`CONTRIBUTING.md`](CONTRIBUTING.md),
  [`SECURITY.md`](SECURITY.md), and a GitHub Actions CI workflow
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) that runs
  build + tests on Ubuntu and Windows against Node 20.
  `package.json` `publisher` / `publishConfig` / `repository` switched
  from internal Azure DevOps to public GitHub + npm; the
  `.npmrc.template` pointing at a private Azure Artifacts feed was
  removed.
- **No functional changes** vs `0.3.1`. The version bump marks the
  distribution change, not a code change.

## [0.3.1] — 2026-05-27

OpenSpec change: [`guard-oversized-review-prompts`](openspec/changes/guard-oversized-review-prompts/proposal.md).

### Added

- **Self-review mandate (`.github/copilot-instructions.md`).** Codifies the
  dog-fooding workflow for this repo: after any non-trivial change under
  `src/` or `test/`, invoke `@codecrosscheck /review-branch` and only commit
  after the reviewer returns `approve` (or the user adjudicates
  disagreements). Doc-only edits and trivial typo fixes are exempt.

### Fixed

- **`/review-branch` no longer turns a too-large diff into a confusing Zod
  schema error.** Previously, passing a multi-megabyte branch diff to the
  reviewer surfaced as `vscode.lm response failed schema "Verdict" twice.
  First: Message exceeds token limit. Retry: … Invalid enum value. Expected
  'approve' | 'revise', received 'invalid' …` because the schema-reminder
  retry re-sent the same oversized prompt. Three new guards make this fail
  fast with actionable messages:
    1. **Hard char-budget guard** on `/review-branch`, governed by the new
       `codecrosscheck.reviewBranch.maxDiffChars` setting (integer,
       default `200000`, `0` disables). When the assembled diff exceeds
       the cap the handler aborts before any LM call with guidance to
       pass a closer `diff-base=<ref>` or split the branch.
    2. **Best-effort token preflight** using the reviewer model's
       `countTokens` + `maxInputTokens` (VS Code 1.93+
       `LanguageModelChat`). When the assembled prompt would consume more
       than 90% of `maxInputTokens`, the handler aborts naming the token
       count, the budget, and the reviewer model id.
    3. **`OversizedPromptError` short-circuit** in both
       `VscodeLmClient.sendStructured` and
       `GithubModelsClient.sendStructured`. Token-limit /
       context-window-exceeded errors from the underlying transport
       (`Message exceeds token limit`, `maximum context length`,
       `prompt is too long`, `request too large`, `context window
       exceeded`) now throw a typed `OversizedPromptError` instead of
       triggering the wasted schema-reminder retry. Covered by
       `test/oversized.test.ts` (4 cases).
- **`OVERSIZED_PATTERNS` tightened to avoid misclassifying transport
  timeouts.** The initial pattern list included a broad fallback
  `\b(?:tokens?|context).{0,40}\bexceed(?:s|ed)?\b` that matched generic
  gRPC/HTTP failures such as `context deadline exceeded`, violating the
  chat-loop spec scenario "Unrelated failures are not misclassified". The
  fallback was removed; the remaining six explicit phrasings still cover
  every provider error enumerated in the spec. Regression test added.
  *(Self-review with `@codecrosscheck /review-branch` caught this issue in
  the same session it was introduced — the dog-food rule pays for itself.)*

## [0.3.0] — 2026-05-19

OpenSpec change: [`rename-openspec-implement-to-review`](openspec/changes/rename-openspec-implement-to-review/proposal.md).

### Changed

- **`/openspec-implement` renamed to `/openspec-review`** to better reflect
  what the command does — it runs a worker↔reviewer dialogue against an
  OpenSpec change frame, it does not actually implement the change.
  `/openspec-implement` is kept as a deprecated alias that prints a notice
  and forwards. Contract test in `test/openspec-review.test.ts`.

## [0.2.10] — 2026-05-19

OpenSpec change: [`fix-model-refusal-detection`](openspec/changes/fix-model-refusal-detection/proposal.md).

### Fixed

- **Content-policy refusals no longer surface as misleading
  `JSON.parse` errors.** When `vscode.lm` returned
  `Sorry, I can't assist with that.` the user previously saw
  `vscode.lm response failed schema "WorkerOutput" twice. First:
  Unexpected token 'S'... Retry: Unexpected token 'e', "text\\nSorry"...`,
  which masked the true cause (the model refused) and burned reviewer
  tokens on a doomed retry. `VscodeLmClient.sendStructured` and
  `GithubModelsClient.sendStructured` now inspect each raw response for
  a refusal pattern *before* parsing, throw a new `ModelRefusalError`
  that names the model and quotes the response, and skip the
  schema-reminder retry (it cannot recover a refusal). The two-strike
  fallback error also now includes a 160-char snippet of each raw
  response so schema drift can be diagnosed from chat output alone.
- **`extractJson` no longer silently unwraps unknown-language fences.**
  The fence regex was `/```(?:json)?\s*([\s\S]*?)```/`, which on a
  ` ```text\nSorry...\n``` ` response stripped the fence and fed
  `text\nSorry...` straight into `JSON.parse`. The regex is now
  `/```(?:json)?\r?\n([\s\S]*?)```/` — only `json` or unlabelled
  fences are unwrapped; everything else falls through to the
  brace-pair fallback. Covered by `test/refusal.test.ts`.

## [0.2.8] — 2026-05-06

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

- **`/review-branch` now supports `diff-base=<ref>` in the prompt.**
  Pass any git ref (branch, tag, SHA) to override the default merge-base
  detection — e.g. `@codecrosscheck /review-branch diff-base=empty`.
  Uses two-dot diff syntax (`ref..HEAD`) so orphan branches work.
- **Merge-base resolution falls back to `origin/master`** when
  `origin/main` does not exist, fixing "No diff" errors in repos that
  use `master` as the default branch.

## [0.2.7] — 2026-05-05

Initial public release of the cross-vendor AI review gate. Establishes the
worker↔reviewer chat loop, the `/review-branch` → `/apply-review` workflow,
and the supporting `applyReview.ts` toolkit.

### Added

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
[0.4.0]: ./CHANGELOG.md#040--2026-05-29
[0.3.1]: ./CHANGELOG.md#031--2026-05-27
[0.3.0]: ./CHANGELOG.md#030--2026-05-19
[0.2.10]: ./CHANGELOG.md#0210--2026-05-19
[0.2.8]: ./CHANGELOG.md#028--2026-05-06
[0.2.7]: ./CHANGELOG.md#027--2026-05-05
[0.2.0]: ./CHANGELOG.md#020--2026-04-28
[0.1.0]: ./CHANGELOG.md#010--2026-04-26
