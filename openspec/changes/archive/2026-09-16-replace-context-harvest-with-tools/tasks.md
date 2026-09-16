# Tasks

## A. Tool-call transport
- [x] A1. Extend `ChatClient` with tool declaration and a tool-call round trip.
       `SendOptions.tools` carries the specs, the invoker, the budget and the
       observation callbacks; `sendText` and `sendStructured` both honour it,
       so no existing caller had to change.
- [x] A2. Implement it for `VscodeLmClient`.
- [x] A3. Implement it for the OpenAI-compatible CLI transport.
       (Written as `GithubModelsClient`; that client was retired before this
       change and replaced by `OpenAiCompatibleClient`.)
- [x] A4. Add a per-run call budget and wall-clock deadline with explicit
       budget-exhausted and deadline-exceeded results.
       On exhaustion the client withdraws the tools, tells the model so, and
       takes one final answer, then reports the stop reason through
       `onFinish`. The spec delta originally said "return the model's last text
       response with a marker"; that cannot work for `sendStructured`, because
       the last response may be a tool call with no text to parse. The delta
       was amended to describe the tool-less final request.
- [x] A5. Contract tests asserting both transports behave identically.
       `test/toolLoop.test.ts` runs one scenario table over both.

## B. Workspace toolset
- [x] B1. Implement read-file, search, and list-directory tools.
- [x] B2. Validate every path with the existing `resolveSafePath` rules.
- [x] B3. Respect repository ignore rules.
       An always-on denylist (VCS metadata, build output, dependency trees,
       credential files) plus `git check-ignore` when the workspace is a
       repository and git is on PATH. The denylist alone cannot know what a
       given repository excludes; git cannot answer outside a repository.
- [x] B4. Record every call and outcome in the transcript.
       `tool-call` and `tool-loop-done` events, plus a chat progress line per
       call so a file read is never invisible to the user.
- [x] B5. Tests: outside-root refused, ignored path refused, no write operation
       exposed.

## C. Remove the harvesting layer
- [x] C1. Delete `harvestPathsFromText`, `resolveReferencedPath`,
       `buildFileInventory`, `parseBlockedFindings` and the file-context cap.
       Also `normalizeReferencedPath`, `allocateBudget`, `parseReferencedFiles`
       and `parseDisagreements`, which had no remaining callers once the
       harvesting and Markdown-parsing paths were gone.
- [x] C2. Replace dodge detection with a structured `unaddressed` field in the
       fixer response.
- [x] C3. Remove the corresponding tests and add tests for the structured field.

## D. Structured fix proposals
- [x] D1. Have the fixer emit edits alongside its explanation.
       `FixProposalSchema`: `summary` plus one `fixes` entry per finding with
       `findingId`, `status`, `explanation` and `edits`.
- [x] D2. Make `/apply-review` consume those edits without a derivation call.
- [x] D3. Delete `apply_review_worker.md`, `buildOldStringCandidates`,
       `repairNewStringFor`, `stripDiffMarkers` and their tests.
       Replaced by tests asserting the opposite: a diff-marked or
       line-ending-drifted `oldString` is now skipped, not repaired.
- [x] D4. Preserve the confirmation checkpoint, dry-run, and path validation.
       `/apply-review` no longer accepts extra instructions, because it no
       longer calls a model that could act on them.

## E. Prompts
- [x] E1. Reduce the grounding rules in `review_branch_fixer.md`.
       The prompt now tells the worker to read before it writes, instead of
       enumerating placeholder phrases to avoid. `finding_triage.md` was
       updated too: "I was not given that file" is no longer a reason for
       `uncertain`.
- [ ] E2. Re-run the planted-flaw corpus and compare pass rates before and
       after.
       **Not done.** `test/corpus.test.ts` skips without `RUN_LIVE_TESTS=1`,
       so this needs a live model run and a recorded before/after. Nothing in
       this change should be read as evidence of the corpus pass rate.

## F. Migration
- [x] F1. Keep reading legacy Markdown-only transcripts in `/apply-review` for
       one release.
       Read and reported, not applied: with the derivation model call gone
       there is nothing that can turn prose into edits, so the handler names
       the situation and points at `/review-branch` rather than applying
       nothing and calling it success.
- [x] F2. CHANGELOG and architecture documentation.
