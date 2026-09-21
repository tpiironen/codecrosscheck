# Fix the tool-loop stall

## Why

A `/review-branch` run appeared to hang at "worker proposes fixes". It was not
hung — `search_workspace` was walking the workspace one `git check-ignore`
subprocess per path, measured at 65 ms per spawn on Windows, and the extension
reported a tool call only *after* it returned. A search that took minutes was
therefore completely invisible while it ran.

Three defects compounded:

1. **`IgnorePolicy` could only be asked about one path at a time.** A tree walk
   over this repository spawned 133 git processes and took 6.7 s. Batching
   per-directory was tried first and was *not* enough — it produced exactly
   those 133 spawns. Only a breadth-first walk asking once per depth level
   brought it down to 7 spawns / 0.48 s.
2. **Nothing reported a tool call until it finished**, so the slow call was
   invisible for precisely as long as it was slow.
3. **The file cap counted files opened, not files walked.** A search narrowed
   with `pathContains` skipped the counter entirely, so `maxFilesScanned` could
   never be reached and the walk could cross a whole repository. The loop's
   wall-clock deadline did not reach the tool either, so a single call could
   outlive the budget that was supposed to bound it.

## What Changes

- `IgnorePolicy` gains an optional `filterIgnored(rels)` answering a whole
  listing in one call; the workspace walk becomes breadth-first so one query
  covers a depth level. A policy shelling out to git must implement it.
- `ToolContext` gains `onCallStart(call)`, fired before `invoke`, and both
  transports call it.
- `ToolContext.invoke` receives a `ToolInvocation { deadlineAt }`;
  `search_workspace` stops at that deadline and says its results are partial.
- The scan cap counts every walked file, and each stop reason — matches, file
  cap, time — is reported distinctly so a truncated result is never mistaken
  for an exhaustive one.

## Impact

- **Affected specs**: `chat-loop` (2 MODIFIED), `vscode-extension` (1 MODIFIED).
- **Affected code**: `src/clients/ChatClient.ts`, `src/clients/vscodeLm.ts`,
  `src/clients/openaiCompatible.ts`, `src/tools/workspaceTools.ts`,
  `src/extension.ts`.
- **Release artefacts**: `package.json`, `package-lock.json`, `CHANGELOG.md`.
  This branch ships the fix as `0.5.1-rc.1`, and the repository's release
  convention is that the version bump, its lockfile mirror and the changelog
  entry land in the same branch as the change they describe — a changelog
  written after the fact describes a release nobody can still verify, and a
  lockfile left at the old version disagrees with `package.json` on install.
  The `CHANGELOG.md` entry covers both changes on this branch, this one and
  `scope-review-to-branch-files`; these edits are release bookkeeping only and
  alter no runtime behaviour.
- **Risk surface**: `filterIgnored` is optional, so a policy that does not
  implement it keeps the per-path behaviour and stays correct, only slow. The
  deadline makes `search_workspace` return partial results where it previously
  returned complete ones — mitigated by stating partiality in the result text.
