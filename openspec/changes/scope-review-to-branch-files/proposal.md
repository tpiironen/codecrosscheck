# Scope review findings to the branch's changed files

## Why

`/review-branch` runs drifted off the branch. The reviewer raised findings
about files the branch never touched, and proposed infrastructure — new
harnesses, indexes, CI machinery — that nothing in the diff implied. The
triager and fixer then inherited that drift, spending their tool budgets on
code that was not under review.

The diff was in the prompt all along, but a patch is a poor statement of scope:
the model has to infer the file list from `diff --git` headers interleaved with
thousands of lines of content. Now that the agents also hold read-only tools,
they can reach any file in the workspace, which made the drift worse rather
than better — the scope has to be stated, not implied.

## What Changes

- The reviewer, triager and fixer prompts gain an explicit block naming every
  path changed on the branch, with the rule that a finding must cite one of
  them.
- Unchanged code is declared to be context for judging a changed line, never
  the subject of a finding in its own right. Where judging a changed line
  depends on code outside the list, the agent cites the changed path and says
  what it could not verify.
- The list is capped, with the remainder reported as a count, so a large branch
  cannot crowd the diff out of the prompt.

## Impact

- **Affected specs**: `prompts` (1 ADDED).
- **Affected code**: `src/extension.ts` (`buildScopeBlock`, threaded into the
  reviewer, triager and fixer inputs), `src/openspec/diff.ts` (`patchPaths`,
  extracted alongside the existing `filterPatchToScope` path parsing).
  `blockPath` is hardened while it is being extracted: it reads the `+++`,
  `---` and `rename to` marker lines before falling back to the `diff --git`
  header, and decodes git's C-quoting. The former `\S+` header pattern was
  wrong twice over — an unquoted path may contain spaces, and git quotes any
  path with spaces or non-ASCII bytes — so a scope list could silently omit
  such a file and every finding against it would then read as out of scope.
- **Risk surface**: a real defect in unchanged code that the branch exposes
  will now be reported against the changed path that exposes it rather than
  suppressed — the requirement says to cite the changed path and state what
  could not be verified, not to stay silent.
