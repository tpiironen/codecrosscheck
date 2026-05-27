# Copilot instructions for this repository

## Eat your own dog food

This repository **is** the CodeCrossCheck extension. After making any
non-trivial code change here, **always invoke the `@codecrosscheck` chat
participant to review the change** before declaring the task complete or
asking the user to commit.

Concrete workflow:

1. Make the code edits and run `npm run build` + `npx vitest run` locally.
2. **Invoke `@codecrosscheck /review-branch` on the working tree.** This
   runs a worker↔reviewer dialogue against the current branch diff and
   produces a structured verdict + fix proposal.
3. If the reviewer returns `revise`, run `@codecrosscheck /apply-review` to
   land the proposed patches, then re-build and re-test.
4. Only after the reviewer returns `approve` (or you have explicitly
   adjudicated each disagreement with the user) should you write the
   commit message and commit.

Rationale: every change to this codebase is a chance to dogfood the tool.
Self-review with a different model has already caught at least one real
bug per session (e.g. the broad `OVERSIZED_PATTERNS` fallback regex that
misclassified `context deadline exceeded` as a token-limit failure). Skipping
the self-review step on this repo wastes that signal.

### Exceptions

Skip the `/review-branch` step only for:

- Pure documentation changes (CHANGELOG, README, ARCHITECTURE, OpenSpec
  proposals — anything outside `src/` and `test/`).
- One-line typo fixes or trivial mechanical edits where there is no logic
  to review.
- Cases where the user has explicitly said "skip review" or "just commit".

Everything else — including refactors, new features, bug fixes,
test-only changes that exercise new code paths, and config/setting
changes that affect runtime behaviour — must go through `/review-branch`.

### When `/review-branch` is unavailable

If the chat participant cannot be invoked from the current context (e.g.
the user is running a subagent without chat tools), state this explicitly
in the response and ask whether to proceed without self-review.
