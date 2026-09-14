# Add chat-picker worker, branch review, and delegation skill

## Why

After the genesis `add-codecrosscheck` change shipped, real-world dogfooding
surfaced four gaps:

1. **Worker model felt fixed.** The chat participant always used
   `codecrosscheck.workerModel`, ignoring whatever the user had selected in
   Copilot Chat's model picker. Users expected `@codecrosscheck` to respect
   the picker the way every other participant does.
2. **No branch-level review.** The CLI could review a single artifact, but
   the natural review unit on a working branch is "everything I've changed
   since `main`." There was no first-class way to review a branch diff.
3. **Default agent didn't know to delegate.** When a user typed
   `review my branch` to the default Copilot agent, the agent self-reviewed
   instead of routing to `@codecrosscheck`. There was no on-disk skill to
   teach the default agent the delegation contract.
4. **OpenSpec validator had a shell-injection seam.** `validateStrict` spawned
   `openspec validate --strict <changeId>` with `shell: true` (required on
   Windows for `.cmd` shims), and accepted `changeId` from chat input without
   validation.

## What Changes

This change extends three existing capabilities and introduces no new ones.

- **`chat-loop`** (extended)
  - CLI gains `--diff` and `--diff-base <ref>` flags. `--diff` appends the
    current branch diff (vs `origin/main` merge-base, falling back to `HEAD`)
    to the task prompt via the existing `getChangeDiff()` helper.
  - Default model pair bumped: worker `openai/gpt-5.4`, reviewer
    `anthropic/claude-opus-4.6`.
- **`vscode-extension`** (extended)
  - New setting `codecrosscheck.useChatPickerWorker` (boolean, default `true`).
    When enabled, the chat participant uses `request.model` (the picker
    selection) as the worker, so `@codecrosscheck` honours the active model.
    The reviewer always stays on `codecrosscheck.reviewerModel` to keep the
    loop cross-vendor; if both resolve to the same model id, the participant
    streams a warning.
  - New slash command `/review-branch [extra instructions]`. Runs the PLAN
    stage as a code review with the current branch diff attached as context.
  - New Command Palette command **CodeCrossCheck: Install Delegation Skill**
    with a Workspace / User QuickPick. Copies the bundled
    `codecrosscheck-delegate` skill from the extension's
    `dist/assets/skills/` to either `<workspace>/.github/skills/` (team-shared)
    or `~/.agents/skills/` (personal, roams via Settings Sync). Refuses
    overwrite without explicit confirmation.
  - The build pipeline (`scripts/copy-assets.mjs`) bundles
    `.github/skills/codecrosscheck-delegate/` into `dist/assets/skills/` so
    the skill ships inside the VSIX.
  - The CLI `codecrosscheck-install` bin gains a `skill [--user]` subcommand
    that installs the same bundled skill from the npm package, for
    contributors who use the CLI without the VSIX.
- **`openspec-integration`** (extended, hardening)
  - `validateStrict` rejects `changeId` values that do not match
    `^[A-Za-z0-9._-]+$` before invoking `child_process.spawn`, closing the
    shell-injection seam introduced by the Windows-required `shell: true`.
  - New script `npm run selftest:openspec` runs an end-to-end PLAN against
    the new `add-sha256-cli` fixture under `openspec/changes/`, validating
    that the OpenSpec frame, validator pre-gate, and reviewer wiring all
    behave correctly against live GitHub Models.

## Impact

- **Affected specs**: deltas to `chat-loop`, `vscode-extension`, and
  `openspec-integration`. No new capabilities.
- **Affected code**: `src/cli.ts`, `src/extension.ts`, `src/install.ts`,
  `src/clients/vscodeLm.ts`, `src/openspec/validate.ts`, `package.json`,
  `scripts/copy-assets.mjs`, `scripts/selftest-openspec.mjs` (new),
  `.github/skills/codecrosscheck-delegate/SKILL.md` (new),
  `openspec/changes/add-sha256-cli/` (new fixture), `README.md`.
- **Risk surface**:
  - Picker-worker collision (worker == reviewer) is detected at runtime and
    surfaced as a chat warning rather than silently defeating the
    cross-vendor invariant.
  - Skill installer refuses to overwrite by default; user must confirm.
  - Validator regex (`^[A-Za-z0-9._-]+$`) is conservative — change ids that
    contain other characters will be rejected with a clear error rather than
    quietly skipped.
- **Out of scope**: automatic skill registration without user opt-in;
  publishing the skill via the VS Code Marketplace (delegation skill is
  internal-only, same as the rest of CodeCrossCheck); auto-detecting the
  remote default branch when it isn't `origin/main`.
- **Self-hosting**: this change was reviewed via `@codecrosscheck` in chat
  using the new `/review-branch` command.
