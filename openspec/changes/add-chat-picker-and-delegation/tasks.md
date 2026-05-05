# Tasks: add-chat-picker-and-delegation

All tasks below are complete; this change documents the work that landed in
the session following the genesis `add-codecrosscheck` ship.

## A. Chat-loop extensions

- [x] A1. Bump default `workerModel` to `openai/gpt-5.4` and `reviewerModel`
  to `anthropic/claude-opus-4.6` in `package.json` and CLI defaults.
- [x] A2. Add `--diff` and `--diff-base <ref>` flags to `src/cli.ts`,
  reusing `getChangeDiff()` from `src/openspec/diff.ts`.
- [x] A3. Document new flags in `README.md` flag table.

## B. VS Code chat-picker worker

- [x] B1. Add setting `codecrosscheck.useChatPickerWorker` (boolean,
  default `true`) to `package.json`.
- [x] B2. Extend `VscodeLmOptions` in `src/clients/vscodeLm.ts` with an
  optional pre-resolved `model: LmChat`. When provided, skip
  `vscode.lm.selectChatModels`.
- [x] B3. In `src/extension.ts`, when `useChatPickerWorker` is `true`, pass
  `request.model` to the worker `VscodeLmClient`.
- [x] B4. Detect worker == reviewer model id collision and surface a
  warning to the chat stream so the cross-vendor invariant is not silently
  broken.

## C. /review-branch slash command

- [x] C1. Register `/review-branch` in `package.json` chat-participant
  contributions.
- [x] C2. Implement handler in `src/extension.ts`: call `getChangeDiff()`
  against the workspace, attach as context, run the PLAN stage as a code
  review.
- [x] C3. Document in `README.md` slash-command list.

## D. Delegation skill (bundle + installers)

- [x] D1. Author `.github/skills/codecrosscheck-delegate/SKILL.md` with
  YAML frontmatter (`name`, `description`) keyed on review/spec-implement
  trigger phrases.
- [x] D2. Update `scripts/copy-assets.mjs` to copy `.github/skills/` to
  `dist/assets/skills/` at build time.
- [x] D3. Add `skill [--user]` subcommand to `src/install.ts` (the
  `codecrosscheck-install` bin). Workspace destination
  `<cwd>/.github/skills/codecrosscheck-delegate/SKILL.md`; user destination
  `<homedir>/.agents/skills/codecrosscheck-delegate/SKILL.md`. Refuses
  overwrite.
- [x] D4. Register `codecrosscheck.installSkill` command + activation event
  in `package.json`.
- [x] D5. Implement `installDelegationSkill(context)` helper in
  `src/extension.ts` with `vscode.window.showQuickPick` (Workspace / User),
  overwrite confirmation, and reload reminder.
- [x] D6. Document both install paths in `README.md`.
- [x] D7. Verify `dist/assets/skills/codecrosscheck-delegate/SKILL.md`
  exists after `npm run build` and that the VSIX includes it.

## E. OpenSpec hardening

- [x] E1. Add `^[A-Za-z0-9._-]+$` regex guard on `changeId` in
  `src/openspec/validate.ts` before `child_process.spawn`. Document the
  rationale (Windows requires `shell: true` for `.cmd` shims).
- [x] E2. Add `add-sha256-cli` fixture under `openspec/changes/` with
  `proposal.md`, `tasks.md`, and `specs/sha256-cli/spec.md`.
- [x] E3. Add `scripts/selftest-openspec.mjs` and wire
  `npm run selftest:openspec` to it.
- [x] E4. Verify both selftests run end-to-end against live GitHub Models.

## F. Acceptance

- [x] F1. `npm run build` succeeds; `dist/assets/skills/...` is present.
- [x] F2. `npm test` shows 19 passed / 8 skipped (no regressions).
- [x] F3. `npm run selftest` and `npm run selftest:openspec` complete
  end-to-end with valid structured verdicts.
