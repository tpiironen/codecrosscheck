# Tasks

> Not started. This change is proposed for a later cycle; see `proposal.md`.

## A. Tool-call transport
- [ ] A1. Extend `ChatClient` with tool declaration and a tool-call round trip.
- [ ] A2. Implement it for `VscodeLmClient`.
- [ ] A3. Implement it for `GithubModelsClient`.
- [ ] A4. Add a per-run call budget and wall-clock deadline with explicit
       budget-exhausted and deadline-exceeded results.
- [ ] A5. Contract tests asserting both transports behave identically.

## B. Workspace toolset
- [ ] B1. Implement read-file, search, and list-directory tools.
- [ ] B2. Validate every path with the existing `resolveSafePath` rules.
- [ ] B3. Respect repository ignore rules.
- [ ] B4. Record every call and outcome in the transcript.
- [ ] B5. Tests: outside-root refused, ignored path refused, no write operation
       exposed.

## C. Remove the harvesting layer
- [ ] C1. Delete `harvestPathsFromText`, `resolveReferencedPath`,
       `buildFileInventory`, `parseBlockedFindings` and the file-context cap.
- [ ] C2. Replace dodge detection with a structured `unaddressed` field in the
       fixer response.
- [ ] C3. Remove the corresponding tests and add tests for the structured field.

## D. Structured fix proposals
- [ ] D1. Have the fixer emit edits alongside its explanation.
- [ ] D2. Make `/apply-review` consume those edits without a derivation call.
- [ ] D3. Delete `apply_review_worker.md`, `buildOldStringCandidates`,
       `repairNewStringFor`, `stripDiffMarkers` and their tests.
- [ ] D4. Preserve the confirmation checkpoint, dry-run, and path validation.

## E. Prompts
- [ ] E1. Reduce the grounding rules in `review_branch_fixer.md`.
- [ ] E2. Re-run the planted-flaw corpus and compare pass rates before and
       after.

## F. Migration
- [ ] F1. Keep reading legacy Markdown-only transcripts in `/apply-review` for
       one release.
- [ ] F2. CHANGELOG and architecture documentation.
