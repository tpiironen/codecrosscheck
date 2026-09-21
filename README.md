# CodeCrossCheck

Two-model review loop for software work. A **worker** LLM produces a plan,
code, or execution log; a **reviewer** LLM (a different vendor by default)
critiques it; the worker revises until the reviewer approves or the iteration
budget is spent. Optionally validates against an [OpenSpec](https://github.com/Fission-AI/OpenSpec)
change before review.

See [CHANGELOG.md](CHANGELOG.md) for release notes and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a deep dive on how the tool
is built (component diagram, sequence diagram, sandbox guarantees, OpenSpec
pre-gate, surface-by-surface walkthrough).

Distributed as **two surfaces from one repo**:

- a Node CLI (`codecrosscheck` / `ccc`)
- a VS Code extension exposing the `@codecrosscheck` chat participant

## Install

This tool is **not published to public npm or the VS Code Marketplace**.
Everything below works from a local clone — no registry, no auth, no
feed configuration. To get a `.vsix` and a working CLI you build from
source. See [Contributing & local install](#contributing--local-install)
for the full step-by-step (clone → build → package → install).

Quick path:

```powershell
git clone <this-repo> C:\src\AI
cd C:\src\AI
npm ci
npm run build

# 1. VS Code extension (chat participant @codecrosscheck)
npx vsce package --no-dependencies
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
  --install-extension .\codecrosscheck-0.5.0.vsix --force

# 2. CLI — link the local checkout, no registry needed
npm link              # exposes `codecrosscheck` and `ccc` globally
```

The `npm link` line creates a global symlink to your checkout's `bin`
entries; iterating on `src/` + `npm run build` is picked up immediately
by the linked binary.

### Install the delegation skill

The repo ships a Copilot skill (`codecrosscheck-delegate`) that teaches
the default chat agent to hand off review and OpenSpec-implementation
requests to `@codecrosscheck` instead of self-reviewing. It's bundled
into the VSIX, so the **VS Code Command Palette → "CodeCrossCheck:
Install Delegation Skill"** is the easiest install (pick Workspace or
User, then reload the window).

From the command line, run the installer bin directly out of the
local build — no `npx` registry lookup:

```powershell
# Workspace scope (commits to .github/skills/, team-shared)
node C:\src\AI\dist\install.js skill

# User scope (~/.agents/skills/, personal, roams via Settings Sync)
node C:\src\AI\dist\install.js skill --user
```

If you ran `npm link` above, `codecrosscheck-install skill [--user]`
works from anywhere too.

## CLI usage

```bash
# Point at any OpenAI-compatible endpoint, then run the default loop
export CODECROSSCHECK_BASE_URL=https://api.openai.com/v1
export CODECROSSCHECK_API_KEY=sk-xxx
codecrosscheck "write a script that prints the SHA-256 of stdin"

# Run a single stage with a custom reviewer
ccc "draft a migration plan" --stages plan --reviewer-model anthropic/claude-opus-5

# A local server needs no key
ccc "…" --base-url http://localhost:11434/v1

# OpenSpec mode — reviewer is pre-gated by `openspec validate --strict`
ccc "implement add-foo" --openspec add-foo
```

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--stages` | `plan,code,execute` | Comma-separated subset |
| `--max-iters` | `6` | Per-stage iteration budget |
| `--worker-model` | `anthropic/claude-opus-5` | Model id as your endpoint names it |
| `--reviewer-model` | `openai/gpt-5.3-codex` | Different vendor from the worker, for cross-vendor review |
| `--base-url <url>` | `$CODECROSSCHECK_BASE_URL` | OpenAI-compatible API root |
| `--timeout-ms` | `30000` | Sandbox per-run timeout |
| `--openspec <id>` | — | Inject change frame + validator pre-gate |
| `--diff` | off | Append current branch diff (vs `origin/main` merge-base) to the task prompt |
| `--diff-base <ref>` | merge-base / HEAD | Override the base ref used by `--diff` |

### Environment

The CLI has **no default provider** — you supply the endpoint.

- `CODECROSSCHECK_BASE_URL` — required. An OpenAI-compatible API root, e.g.
  `https://api.openai.com/v1`, an Azure AI Foundry deployment URL, or
  `http://localhost:11434/v1` for Ollama. `/chat/completions` is appended.
- `CODECROSSCHECK_API_KEY`, or `OPENAI_API_KEY` — **optional**. When neither is
  set the `Authorization` header is omitted, so keyless local servers work.

The VS Code extension does not use these; it runs on the Copilot models exposed
through `vscode.lm`.

### Transcripts

Every run appends one JSONL event per pipeline event to
`.codecrosscheck/runs/<ISO-timestamp>.jsonl`. Includes worker drafts, verdicts
(with `source: "model" | "validator"`), sandbox results, and the final
`completed` record.

## VS Code extension

Activate with `@codecrosscheck` in chat. Slash commands:

- `/plan`, `/code`, `/execute` — single-stage runs
- `/review-branch [extra instructions]` — worker↔reviewer dialogue on the
  current branch diff (vs `origin/main` or `origin/master` merge-base).
  Add `diff-base=<ref>` to override (e.g. `diff-base=HEAD~3`,
  `diff-base=empty`). Iteration 1: reviewer reads the diff and emits findings
  (every finding it can identify, ordered high → low). Iterations 2..N: the
  findings are triaged, then the worker answers each surviving one, and the
  reviewer re-judges. Capped by `codecrosscheck.maxIters`, or per-invocation by
  adding `max-iters=N` / `iters=N` (range 1..20) to the prompt.

  The worker answers every finding with a status:

  | Status | Meaning |
  |---|---|
  | `fixed` | Carries exact edits that resolve the finding |
  | `disagree` | The finding is wrong; the explanation is the rebuttal, and no edits are produced |
  | `unaddressed` | Real or not, the worker could not produce an edit, and says what stopped it |

  Rebuttals are surfaced at the end of the run for you to adjudicate: accept
  them by running `/apply-review` (a rebutted finding carries no edits), or
  override by re-running with `force-fix-all` anywhere in the prompt, which
  requires a concrete fix for every finding and withdraws `disagree`.

  The triager and the worker have **read-only access to the workspace** —
  `read_file`, `search_workspace`, `list_directory` — and fetch whatever source
  they need mid-reasoning. Every call is shown in the progress stream and
  recorded in the transcript. See [Workspace toolset](#workspace-toolset).
- `/apply-review` — apply the latest `/review-branch` fix proposal to the
  working tree. It reads the edits the worker already produced from the review
  transcript and applies them; **it calls no model**. Each path is validated to
  resolve under the workspace root, and each `oldString` must occur exactly
  once. Line endings are the only difference repaired — a model reads a CRLF
  file correctly and still emits LF in its JSON — so an `oldString` that
  differs by anything else is skipped with a reason rather than guessed at.
  An empty `oldString` creates a new file.

  Edits land through `vscode.workspace.applyEdit`, so the whole batch is one
  undo step and files with unsaved changes are edited in the document. That
  also means **nothing is on disk until you save** — the summary says so and
  offers a Save button. Every run writes a debug log at
  `<workspace>/.codecrosscheck/runs/<iso>-apply.json`. Recommended loop:
  `/review-branch` → `/apply-review` → save → `git diff` → commit. Use
  `codecrosscheck.applyReview.dryRun` to preview without writing.
- `/openspec-init`, `/openspec-new <id>`, `/openspec-review <id>`,
  `/openspec-archive <id>` — see [Spec-driven implementation](#spec-driven-implementation) below.
  (`/openspec-implement` is kept as a deprecated alias for `/openspec-review`.)

### Spec-driven implementation

If you have an OpenSpec change folder under `openspec/changes/<id>/`
(with `proposal.md`, optional `tasks.md`, and optional `specs/**/spec.md`),
the two-step workflow is:

1. `@codecrosscheck /openspec-review <change-id>` — loads the change frame,
   runs `openspec validate <id> --strict` as a pre-gate before each
   reviewer call, drives the worker through PLAN and CODE stages, and
   writes a transcript to `.codecrosscheck/runs/<iso>.jsonl`. The
   EXECUTE stage is skipped (the sandbox can never reproduce a real
   workspace, so its verdict would be misleading).
2. `@codecrosscheck /apply-review` — reads the transcript and applies the
   edits the worker already produced, validating each path under the
   workspace root. No model call. Optionally runs the configured
   `applyReview.buildCommand` as a gate. Use
   `codecrosscheck.applyReview.dryRun` to preview without writing.

The two-step shape mirrors `/review-branch` → `/apply-review` so there is
one mental model for "draft → write". The transcript files are
interchangeable between the two flows.

Editor commands (Command Palette):

- **CodeCrossCheck: Review Selection** — single-shot reviewer on selection
- **CodeCrossCheck: Review Active File** — single-shot reviewer on whole file

### Workspace toolset

During `/review-branch`, the triager and the worker are given a **read-only**
view of the workspace and fetch what they need while reasoning:

| Tool | Purpose |
|---|---|
| `read_file` | Read a file, optionally a line range |
| `search_workspace` | Find a symbol or pattern, returning `path:line: text` |
| `list_directory` | List a directory's entries |

This replaced a pass that scraped likely file paths out of the reviewer's prose
and pre-injected their contents. That could not work: the file an agent turns
out to need is often one the finding never mentions, which is only discovered
mid-reasoning.

The toolset exposes **no operation that writes, creates or deletes**. Every
path is confined to the workspace root, screened against a denylist (VCS
metadata, build output, dependency trees, and credential files such as `.env`,
`*.pem`, `id_rsa`), and then checked against the repository's own ignore rules
via `git check-ignore` when the workspace is a git repository. Each agent's
gathering phase is bounded by `codecrosscheck.tools.maxCalls` and
`codecrosscheck.tools.deadlineMs`; when a budget runs out the model is told so
and must answer from what it has. Set `maxCalls` to `0` to disable tools.

Every call is streamed to the chat progress line and recorded in the run
transcript as a `tool-call` event, so a file read is never invisible.

### Settings

| Setting | Default |
|---|---|
| `codecrosscheck.workerModel` | `anthropic/claude-opus-5` (free text) |
| `codecrosscheck.reviewerModel` | `openai/gpt-5.3-codex` (free text) |
| `codecrosscheck.workerModelOverride` | `""` (deprecated, still honoured) |
| `codecrosscheck.reviewerModelOverride` | `""` (deprecated, still honoured) |
| `codecrosscheck.useChatPickerWorker` | `true` |
| `codecrosscheck.maxIters` | `6` |
| `codecrosscheck.reviewBranch.maxDiffChars` | `1100000` |
| `codecrosscheck.reviewBranch.keepTranscripts` | `50` |
| `codecrosscheck.applyReview.buildCommand` | `""` (machine-scoped) |
| `codecrosscheck.applyReview.buildTimeoutMs` | `300000` |
| `codecrosscheck.applyReview.testCommand` | `""` (machine-scoped) |
| `codecrosscheck.applyReview.dryRun` | `false` |
| `codecrosscheck.tools.maxCalls` | `24` (`0` disables tool access) |
| `codecrosscheck.tools.deadlineMs` | `180000` |
| `codecrosscheck.execute.timeoutMs` | `30000` |

`buildCommand` and `testCommand` are **machine-scoped**: a workspace cannot set
them, and `/apply-review` runs them only in a trusted workspace. Without that,
cloning a repository and running `/apply-review` would execute a command the
repository chose.

The extension uses `vscode.lm` (Copilot subscription) — the `family` portion of
each model id is passed to `selectChatModels({vendor:"copilot",family})`.

Run **CodeCrossCheck: Pick Worker and Reviewer Models** from the command
palette to choose from the families this VS Code session can actually reach.
Both settings are plain strings, so a newly released model works immediately;
the two `*Override` settings are deprecated leftovers from when the settings
were dropdowns, and still take precedence when non-empty.

When `useChatPickerWorker` is `true` (the default), the chat participant uses
the model picked in the Copilot Chat **model picker** as the worker, so
`@codecrosscheck` respects your current selection. The reviewer always uses
`codecrosscheck.reviewerModel` to keep the loop cross-vendor. If both resolve
to the same model, the participant prints a warning. Set
`useChatPickerWorker` to `false` to always use `workerModel`.

## Development

```bash
nvm use            # Node 20
npm install
npm run build      # tsc + copy prompts/skills + bundle the extension
npm test           # vitest, no network
RUN_LIVE_TESTS=1 npm test    # opt-in live integration; needs CODECROSSCHECK_BASE_URL
npm run selftest             # end-to-end PLAN→CODE→EXECUTE; skips without an endpoint
npm run selftest:openspec    # end-to-end with --openspec add-sha256-cli fixture
```

Repo layout:

```
src/
  cli.ts               # commander entry, JSONL transcript
  extension.ts         # chat participant + editor commands
  install.ts           # installer bin (VSIX + delegation skill)
  agents.ts            # buildWorker / buildReviewer / buildTriager / buildFixer
  loop.ts              # reviewLoop + preReview hook
  pipeline.ts          # plan→code→execute orchestration
  sandbox.ts           # spawn-based sandbox (temp cwd, env allowlist, hard
                       # timeout — containment, NOT a security boundary:
                       # generated code runs with your privileges and
                       # unrestricted network)
  schemas.ts           # zod Issue / Verdict / Triage / FixProposal / ApplyEdit
  applyReview.ts       # transcript discovery, edit matching + application
  clients/
    ChatClient.ts          # interface, tool-call contract, budgets
    openaiCompatible.ts    # CLI client (global fetch + json_schema)
    vscodeLm.ts            # extension client (vscode.lm + extractJson)
  tools/
    workspaceTools.ts      # read-only read_file / search_workspace /
                           # list_directory, path-confined and ignore-aware
  openspec/
    loader.ts              # findOpenSpecRoot / loadChange / renderChangeFrame
    validate.ts            # `openspec validate --strict` wrapper (regex-guarded)
    diff.ts                # git diff scoping + patch chunking
  prompts/                 # *.md system prompts (copied to dist/ at build)
scripts/
  copy-assets.mjs          # bundles src/prompts/ + .github/skills/ into dist/
  selftest.mjs             # end-to-end live PLAN→CODE→EXECUTE smoke
  selftest-openspec.mjs    # end-to-end live with --openspec fixture
  release.mjs              # pre-package gate (clean tree, branch=main, private, verify)
  bundle-extension.mjs     # esbuild bundle of the extension entry point
docs/
  ARCHITECTURE.md          # component + sequence diagrams, deep dive
openspec/
  changes/                 # proposal + tasks + spec deltas per change
  project.md, AGENTS.md
.github/
  skills/codecrosscheck-delegate/SKILL.md   # delegation skill (bundled into VSIX)
test/
  helpers/FakeChatClient.ts
  *.test.ts
```

## Contributing & local install

This is the loop for making a change to the tool, building a new `.vsix`,
and installing it into your own VS Code without going through any
registry.

### 1. Make the change

```bash
nvm use            # Node 20
npm install
# edit src/, src/prompts/, package.json, etc.
npm run build      # tsc + copy prompts/skills + bundle the extension
npm test           # vitest, must stay green
```

If you changed behaviour, also update:

- [`CHANGELOG.md`](CHANGELOG.md) — add a bullet under `[Unreleased]`.
- [`README.md`](README.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  — for any user-visible flag, slash command, prompt token, or flow
  change.
- An OpenSpec change folder under `openspec/changes/<id>/` — proposal,
  tasks, spec deltas. Validate strict before merging:
  ```bash
  npx openspec validate <id> --strict
  ```

### 2. Try it in the Extension Development Host

Press `F5` in VS Code (or **Run and Debug → Run CodeCrossCheck Extension**) to
open an EDH window with your local build loaded. This is the fastest inner
loop — no packaging, no install, edits to `dist/` are picked up after a
rebuild + reload. Note that the host window inherits your installed
extensions, so uninstall any released build that shares the participant id if
you need certainty about which one answered.

### 3. Bump the version

Pick a version per [SemVer](https://semver.org/) (pre-1.0: minor for
breaking changes, patch for fixes):

```bash
npm version patch --no-git-tag-version
# or: npm version minor --no-git-tag-version
```

This rewrites `package.json` `"version"`. Rename the `[Unreleased]`
heading in `CHANGELOG.md` to `[<new-version>] - YYYY-MM-DD` and start a
fresh empty `[Unreleased]` block above it.

### 4. Run the release gate

```bash
npm run release
```

Refuses to proceed unless the tree is clean, the branch is `main`, the
package name is intact, `"private": true` is still set, and
`npm run verify` is green. It publishes nothing — it gates what you are
about to package.

### 5. Build the VSIX

```bash
npm run build
npx vsce package --no-dependencies
```

The VSIX is not published to the Marketplace; it is installed from the
local file. Verify a fresh build actually contains your change rather than
trusting the version string — unzip it and grep `extension/dist/extension.cjs`
for a symbol you just added.

### 6. Install into your VS Code

Use `code.cmd` directly — the bare `code` shim on PowerShell can detach
from stderr and exit 0 even when the install silently failed:

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
  --install-extension .\codecrosscheck-<version>.vsix --force
```

You should see `Extension 'codecrosscheck-<version>.vsix' was
successfully installed.` Verify it actually landed on disk (this is the
source of truth — the `--list-extensions` output can lag behind a
running VS Code instance):

```powershell
Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Directory |
  Where-Object Name -match codecrosscheck
# expect: tpiironen.codecrosscheck-<version>
```

Then **fully close all VS Code windows** and reopen, or run
`Developer: Reload Window` in every open window. Find it in:

- **Extensions view** (`Ctrl+Shift+X`) → `@installed codecrosscheck`.
- **Copilot Chat** — type `@codecrosscheck` and the slash commands
  `/review-branch`, `/apply-review` should autocomplete.

To uninstall:

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
  --uninstall-extension tpiironen.codecrosscheck
```

(`tpiironen` is the `publisher` field in `package.json`; the extension
id is `<publisher>.<name>`.)

### 7. Hand it to a teammate

The `.vsix` is a single file — share it directly (Teams, file share,
attached to a PR build artifact) and the recipient runs the same
 `code.cmd --install-extension` command from step 6. For the CLI, share
the repo URL and have them run `npm ci && npm run build && npm link`.
No registry, no signing, no Marketplace.

## Distribution

This repo deliberately ships **no public artifacts**:

- No public npm package.
- No VS Code Marketplace listing.
- No registry of any kind.

`package.json` sets `"private": true`, which is what enforces that: it
is the one thing standing between a stray `npm publish` and the public
registry. [scripts/release.mjs](scripts/release.mjs) is a pre-package
gate, not a publisher — it checks for a clean tree on `main`, the
package name, `private`, and a green `npm run verify`, then tells you to
run `vsce package`.

## Security notes

- EXECUTE sandbox: spawn (no shell), env allowlist, fresh tmpdir per run,
  hard-killed on timeout. It is **containment, not a security boundary**:
  generated code runs as the invoking user with unrestricted network. There is
  no network toggle, because none was ever implemented.
- Reviewer prompt names OWASP A01–A10 explicitly so injection-style flaws
  (like raw SQL string concat) are flagged with severity `high`.
- Validator pre-gate (OpenSpec mode) blocks reviewer calls when
  `openspec validate --strict` fails — zero reviewer tokens spent on
  structurally invalid changes.
