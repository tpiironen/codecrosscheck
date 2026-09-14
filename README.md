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
npx vsce package --allow-missing-repository `
  --baseContentUrl https://example.invalid/ `
  --baseImagesUrl  https://example.invalid/ `
  --out codecrosscheck-0.2.0.vsix
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
  --install-extension .\codecrosscheck-0.2.0.vsix --force

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
# Default plan→code→execute loop, GitHub Models endpoint
GITHUB_TOKEN=ghp_xxx codecrosscheck "write a script that prints the SHA-256 of stdin"

# Run a single stage with a custom reviewer
ccc "draft a migration plan" --stages plan --reviewer-model anthropic/claude-opus-5

# OpenSpec mode — reviewer is pre-gated by `openspec validate --strict`
ccc "implement add-foo" --openspec add-foo
```

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--stages` | `plan,code,execute` | Comma-separated subset |
| `--max-iters` | `6` | Per-stage iteration budget |
| `--worker-model` | `anthropic/claude-opus-5` | GitHub Models id |
| `--reviewer-model` | `openai/gpt-5.3-codex` | Different vendor from the worker, for cross-vendor review |
| `--allow-network` | off | EXECUTE sandbox network access |
| `--timeout-ms` | `30000` | Sandbox per-run timeout |
| `--openspec <id>` | — | Inject change frame + validator pre-gate |
| `--diff` | off | Append current branch diff (vs `origin/main` merge-base) to the task prompt |
| `--diff-base <ref>` | merge-base / HEAD | Override the base ref used by `--diff` |

### Environment

- `GITHUB_TOKEN` — required for the GitHub Models endpoint, scope `models:read`.

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
  `diff-base=empty`). Iteration 1: reviewer
  reads the diff and emits findings (every finding it can identify, ordered
  high → low). Iterations 2..N: worker proposes a complete, self-contained
  fix proposal for every finding, reviewer re-judges. Capped by
  `codecrosscheck.maxIters`, or per-invocation by adding
  `max-iters=N` / `iters=N` (range 1..20) to the prompt. The worker may
  push back on a finding by writing `**Fix:** Disagree: …`; such
  rebuttals are surfaced at the end of the run and the user adjudicates
  by either accepting (run `/apply-review` — rebutted findings produce
  no edits) or overriding (re-run with `force-fix-all` anywhere in the
  prompt to require a concrete fix for every finding). Issues where
  the worker dodged via prose / sketches without using the explicit
  `Disagree:` token are surfaced as a separate "🚫 finding(s) the
  worker did not produce a real patch for" block. When the reviewer
  cites a file outside the diff, the next iteration auto-injects the
  current contents of the cited files into the fixer input so it can
  produce real patches.
- `/apply-review [extra instructions]` — apply the latest `/review-branch`
  fix proposal to the working tree. Reads the most recent review
  transcript, has the worker derive structured `{path, oldString, newString}`
  edits, validates each path stays under the workspace root and each
  `oldString` is unique, and writes via `vscode.workspace.fs`. Includes
  safety-net repairs (CRLF↔LF normalisation and unified-diff stripping)
  so worker output that's slightly off still applies, and a create-mode
  (empty `oldString`) for new files. Every run writes a debug log at
  `<workspace>/.codecrosscheck/runs/<iso>-apply.json`. Recommended
  loop: `/review-branch` → `/apply-review` → `git diff` → commit. Use
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
2. `@codecrosscheck /apply-review` — reads the transcript, derives
   structured `{path, oldString, newString}` edits from the CODE-stage
   artifact, validates each path under the workspace root, and writes
   the edits via `vscode.workspace.fs`. Optionally runs the configured
   `applyReview.buildCommand` as a gate. Use
   `codecrosscheck.applyReview.dryRun` to preview without writing.

The two-step shape mirrors `/review-branch` → `/apply-review` so there is
one mental model for "draft → write". The transcript files are
interchangeable between the two flows.

Editor commands (Command Palette):

- **CodeCrossCheck: Review Selection** — single-shot reviewer on selection
- **CodeCrossCheck: Review Active File** — single-shot reviewer on whole file

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
npm run build      # tsc + copy prompts + skills
npm test           # vitest, no network
RUN_LIVE_TESTS=1 npm test    # opt-in live integration via GITHUB_TOKEN
npm run selftest             # end-to-end PLAN→CODE→EXECUTE against GitHub Models
npm run selftest:openspec    # end-to-end with --openspec add-sha256-cli fixture
```

Repo layout:

```
src/
  cli.ts               # commander entry, JSONL transcript
  extension.ts         # chat participant + editor commands
  install.ts           # installer bin (VSIX + delegation skill)
  agents.ts            # buildWorker / buildReviewer
  loop.ts              # reviewLoop + preReview hook
  pipeline.ts          # plan→code→execute orchestration
  sandbox.ts           # spawn-based sandbox (network deny by default)
  schemas.ts           # zod Issue / Verdict / Stage
  clients/
    ChatClient.ts          # interface
    githubModels.ts        # CLI client (global fetch + json_schema)
    vscodeLm.ts            # extension client (vscode.lm + extractJson)
  openspec/
    loader.ts              # findOpenSpecRoot / loadChange / renderChangeFrame
    validate.ts            # `openspec validate --strict` wrapper (regex-guarded)
    diff.ts                # git diff scoping + patch chunking
  prompts/                 # *.md system prompts (copied to dist/ at build)
scripts/
  copy-assets.mjs          # bundles src/prompts/ + .github/skills/ into dist/
  selftest.mjs             # end-to-end live PLAN→CODE→EXECUTE smoke
  selftest-openspec.mjs    # end-to-end live with --openspec fixture
  release.mjs              # publish guard (clean tree, branch=main, registry check)
  publish-vsix.mjs         # az artifacts universal publish wrapper
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
npm run build      # tsc + copy prompts + skills
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

Press `F5` in VS Code (or **Run and Debug → Launch Extension**) to open
an EDH window with your local build loaded. This is the fastest inner
loop — no packaging, no install, edits to `dist/` are picked up after a
rebuild + reload.

### 3. Bump the version

Pick a version per [SemVer](https://semver.org/) (pre-1.0: minor for
breaking changes, patch for fixes):

```bash
npm version patch --no-git-tag-version   # 0.2.0 -> 0.2.1
# or: npm version minor --no-git-tag-version
```

This rewrites `package.json` `"version"`. Move the `[Unreleased]`
section in `CHANGELOG.md` under a new `[0.2.1] - YYYY-MM-DD` heading
and start a fresh `[Unreleased]` block.

### 4. Build the VSIX

```bash
npm run build
npx vsce package --allow-missing-repository `
  --baseContentUrl https://example.invalid/ `
  --baseImagesUrl  https://example.invalid/ `
  --out codecrosscheck-<version>.vsix
```

The base-URL stubs are only needed because this VSIX is not published
to the Marketplace and `vsce` insists on a repo origin for relative
links in `README.md`. Replace them with your real Azure DevOps repo URL
once the `repository.url` field in `package.json` is updated.

### 5. Install into your VS Code

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
# expect: internal.codecrosscheck-<version>
```

Then **fully close all VS Code windows** and reopen, or run
`Developer: Reload Window` in every open window. Find it in:

- **Extensions view** (`Ctrl+Shift+X`) → `@installed codecrosscheck`.
- **Copilot Chat** — type `@codecrosscheck` and the slash commands
  `/review-branch`, `/apply-review` should autocomplete.

To uninstall:

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" `
  --uninstall-extension internal.codecrosscheck
```

(`internal` is the `publisher` field in `package.json`; the extension
id is `<publisher>.<name>`.)

### 6. Hand it to a teammate

The `.vsix` is a single file — share it directly (Teams, file share,
attached to a PR build artifact) and the recipient runs the same
`code.cmd --install-extension` command from step 5. For the CLI, share
the repo URL and have them run `npm ci && npm run build && npm link`.
No registry, no signing, no Marketplace.

## Distribution

This repo deliberately ships **no public artifacts**:

- No public npm package.
- No VS Code Marketplace listing.
- No Azure Artifacts feed required for ordinary use.

The `scripts/release.mjs` and `scripts/publish-vsix.mjs` scripts and the
`.npmrc.template` / `publishConfig` entries in `package.json` are
placeholders for an optional future internal feed. They are **not
exercised** by the local build-and-install flow above and you do not
need to configure them. If a private feed is set up later, those
scripts give it a one-command path; until then, ignore them.

## Security notes

- EXECUTE sandbox: spawn (no shell), env allowlist, `NO_PROXY=*` when network
  denied, fresh tmpdir per run, hard-killed on timeout.
- Reviewer prompt names OWASP A01–A10 explicitly so injection-style flaws
  (like raw SQL string concat) are flagged with severity `high`.
- Validator pre-gate (OpenSpec mode) blocks reviewer calls when
  `openspec validate --strict` fails — zero reviewer tokens spent on
  structurally invalid changes.
