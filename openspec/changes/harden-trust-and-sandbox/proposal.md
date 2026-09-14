# Harden workspace trust and the execution sandbox

## Why

Three of the extension's trust boundaries are weaker than their documentation
claims.

**1. A repository can choose the command the extension runs.**
`codecrosscheck.applyReview.buildCommand` and
`codecrosscheck.applyReview.testCommand` are contributed with no `scope`, so
they default to `window` scope and a workspace `.vscode/settings.json` can set
them. Cloning a repository, trusting it (the ordinary flow), and running
`/apply-review` then executes an attacker-chosen shell command via
`runBuildGate` and `Terminal.sendText`.

The extension currently escapes this only by omission: with no
`capabilities.untrustedWorkspaces` declaration, VS Code disables the extension
in Restricted Mode. That protects untrusted workspaces only, and relies on a
default the manifest never states.

**2. `execute.allowNetwork: false` does nothing.**
The sandbox implements network denial as `env.NO_PROXY = "*"`. `NO_PROXY`
instructs HTTP clients to *bypass the proxy* for the listed hosts — it is the
opposite of a block, and it is advisory even for clients that honour it.
Meanwhile the child process runs `process.execPath` on model-generated code
with the user's full filesystem privileges and `HOME`/`USERPROFILE` in the
environment allowlist; only `cwd` is isolated. The setting's "best-effort
only" caveat covers imprecision, not a flag with no effect.

**3. Transcripts containing full source diffs are written into the workspace.**
`openTranscript` writes to `.codecrosscheck/runs/` inside the user's
workspace, unbounded and never pruned. This repository's own `.gitignore`
covers that path; a consumer's does not, so branch diffs can be committed and
pushed.

The same directory is then searched by reading **every** transcript in full and
testing `text.includes('"review-branch-done"')` — so a stored worker artifact
that merely quotes the event name, such as a review of this codebase, is
mistaken for a completed run. Every event is written with `appendFileSync` on
the extension host thread.

Additionally, `runBuildGate` uses `child_process.exec` on a command string,
which `openspec/AGENTS.md` explicitly forbids ("Never `exec` a string").

## What Changes

- **MODIFIED capability `vscode-extension`**: settings that determine command
  execution SHALL be contributed with a scope that prevents workspace
  override, and the manifest SHALL declare its Workspace Trust posture
  explicitly.
- **MODIFIED capability `vscode-extension`**: `/apply-review` SHALL refuse to
  run the build or test command when the workspace is not trusted.
- **MODIFIED capability `chat-loop`**: the sandbox SHALL NOT advertise a
  network control it does not implement. The ineffective `NO_PROXY` mechanism
  SHALL be removed and the capability SHALL be described accurately at the
  point of configuration.
- **MODIFIED capability `vscode-extension`**: the transcript directory SHALL
  be self-ignoring, so transcripts cannot be committed by accident, and old
  transcripts SHALL be pruned.
- **MODIFIED capability `vscode-extension`**: transcript discovery SHALL match
  a parsed terminating event near the tail rather than substring-scanning every
  file, and transcript writes SHALL NOT block the extension host.
- **MODIFIED capability `vscode-extension`**: the verdict webview SHALL carry
  a restrictive Content Security Policy and SHALL declare empty
  `localResourceRoots`.

## Impact

- Affected specs: `vscode-extension`, `chat-loop`.
- Affected code: `package.json` (setting scopes, `capabilities`),
  `src/extension.ts`, `src/applyReview.ts`, `src/sandbox.ts`.
- Affected tests: `test/sandbox.test.ts`, `test/applyReview.test.ts`.
- User-visible change: `buildCommand` / `testCommand` can no longer be set per
  workspace and must be set in user or machine settings; `execute.allowNetwork`
  is removed; transcripts are pruned and self-ignored.
- **Breaking**: any existing workspace-level `applyReview.buildCommand` or
  `applyReview.testCommand` value stops taking effect and must be moved to
  user settings. `codecrosscheck.execute.allowNetwork` is removed.
