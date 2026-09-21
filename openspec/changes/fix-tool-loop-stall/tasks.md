# Tasks

## A. Batch the ignore lookups

- [x] A1 Add optional `filterIgnored(rels)` to `IgnorePolicy`, documented as
      mandatory for any policy that shells out per path.
- [x] A2 Implement it in `repositoryIgnorePolicy` with a single
      `git check-ignore -z --stdin` call.
- [x] A3 Make the workspace walk breadth-first so one query covers a depth level.
- [x] A4 Re-measure on this repository after the change — per-directory batching
      already looked like a fix and was not one.

## B. Report a call while it runs

- [x] B1 Add `ToolContext.onCallStart(call)`.
- [x] B2 Fire it before `invoke` in both transports.
- [x] B3 Move the extension's progress line from `onCall` to `onCallStart`.

## C. Bound a single call

- [x] C1 Add `ToolInvocation { deadlineAt }` and pass the loop's deadline through
      `invoke` in both transports.
- [x] C2 Stop `search_workspace` at the deadline.
- [x] C3 Count walked files rather than opened files against `maxFilesScanned`.
- [x] C4 Report matches / file-cap / time stops distinctly in the result text.

## D. Verification

- [x] D1 Red-proof each fix: sabotage it and confirm a targeted test fails.
- [x] D2 Run the tool-loop scenario table over both transports.
- [ ] D3 Run `@codecrosscheck /review-branch` on this branch (repo policy for
      any change under `src/`).
