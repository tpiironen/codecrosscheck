# Tasks: rename-openspec-implement-to-review

## 1. Extension command handler

- [ ] 1.1 Extract the `implement` branch of `handleOpenSpecCommand` into a
      dedicated `handleOpenSpecReview` function.
- [ ] 1.2 Wrap the handler in `try { … } catch (err) { stream.markdown(…) }`
      so `loadChange` failures (missing folder, missing proposal.md) surface
      in chat instead of being swallowed.
- [ ] 1.3 Stream the change's proposal as the first message, truncated to
      ~2 KB for chat (full proposal stays in the injected frame).
- [ ] 1.4 Replace the minimal `onEvent` handler with the same rich event
      formatter used by the `/code` slash command (per-iteration headers,
      worker/reviewer streaming, verdict rendering, severity icons).
- [ ] 1.5 Write transcript events in the `review-branch-iter` (one per
      worker artifact) / `review-branch-done` (final) format that
      `findLatestTranscript` + `extractFixProposal` already consume.
- [ ] 1.6 Default `stages` to `["plan", "code"]` for OpenSpec runs. The
      `execute` stage runs sandboxed code, which can never reproduce a real
      workspace, so its verdict is misleading for implementation work.
- [ ] 1.7 Final chat message instructs the user to run `/apply-review` and
      links the transcript file.

## 2. Command registration

- [ ] 2.1 Register `openspec-review` in `package.json` `contributes.chatParticipants[].commands`.
- [ ] 2.2 Route `verb === "review"` to `handleOpenSpecReview`.
- [ ] 2.3 Keep `verb === "implement"` registered. Its handler prints
      `"⚠️ /openspec-implement is deprecated. Use /openspec-review."` then
      forwards to `handleOpenSpecReview`.

## 3. Spec update

- [ ] 3.1 In `openspec/changes/add-codecrosscheck/specs/openspec-integration/spec.md`,
      replace the `Implement command runs full pipeline` scenario with one
      that matches the renamed command and the no-EXECUTE default.
- [ ] 3.2 Add a scenario asserting the transcript is written in a format
      readable by `/apply-review`.

## 4. Tests

- [ ] 4.1 New file `test/openspec-review.test.ts`.
- [ ] 4.2 Test: handler writes a `.jsonl` containing at least one
      `review-branch-iter` event with `role: "worker"` and a final
      `review-branch-done` event.
- [ ] 4.3 Test: `findLatestTranscript` (imported from `applyReview.ts`)
      returns the file the handler just wrote.
- [ ] 4.4 Test: `extractFixProposal` returns the CODE worker artifact.

## 5. Docs

- [ ] 5.1 README — replace `/openspec-implement` row in the slash command
      table with `/openspec-review`. Add a "Spec-driven implementation"
      subsection showing the two-step flow.
- [ ] 5.2 README — note that `/openspec-implement` remains as a deprecated
      alias.

## 6. Release

- [ ] 6.1 Bump `version` in `package.json` to `0.3.0` (user-visible command
      rename warrants a minor bump).
- [ ] 6.2 Build, run tests, package VSIX, install locally.
- [ ] 6.3 Commit, push to `origin/master`.
