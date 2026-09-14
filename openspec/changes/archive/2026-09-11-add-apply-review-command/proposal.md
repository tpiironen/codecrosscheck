# Add /apply-review slash command

## Why

The `/review-branch` dialogue loop produces a high-quality fix proposal,
but the user has no built-in way to turn that proposal into actual file
edits. They have to copy the proposal into a separate Copilot Chat
session and prompt the default agent to apply it. That round-trip:

- Loses provenance — the transcript and the applied edits live in
  different sessions, so cross-checking what was applied vs what was
  proposed is manual.
- Risks drift — the default agent may interpret ambiguous snippets
  differently than the proposal intended, or skip findings silently.
- Has no closure path back to `@codecrosscheck` — the user can re-run
  `/review-branch` after applying, but there's no explicit "verify
  the fixes landed" step.

A first-class `/apply-review` slash command closes the loop: it reads
the most recent review transcript, derives concrete file edits from
the latest fix proposal, applies them to the working tree, and
optionally runs the workspace's test command. The user's only manual
step is `git diff` + commit.

`/apply-review` is intentionally separate from `/review-branch` because
applying edits is a fundamentally different operation from reviewing
them — it writes files, may run shell commands, and may break the
working tree. Keeping the two slash commands separate means
`/review-branch` stays read-only and safe to run on any branch
(including read-only inspection of someone else's work), and
`/apply-review` is the explicit, opt-in "do it" step.

## What Changes

This change extends one capability (`vscode-extension`) and adds no new
ones.

- **`vscode-extension`** (extended)
  - New slash command `/apply-review`. The handler:
    1. Locates the most recent review transcript JSONL in the
       extension's transcripts folder. If none exists, surfaces a
       clear error pointing to `/review-branch`.
    2. Extracts the last `review-branch-iter` event with
       `role: "worker"` — the final fix proposal — and the issues
       from the matching reviewer iteration.
    3. Parses `// path: <file>` directives from the proposal's code
       blocks and reads each referenced file from the workspace.
       Path normalisation strips `(...)` annotations, `:line` and
       `:line-line` suffixes, and progressively drops leading
       segments to recover repo-prefixed paths in monorepo layouts.
    4. Calls the worker model with the new
       `apply_review_worker` prompt: input = the fix proposal +
       current file contents; output = a structured JSON array of
       `{path, oldString, newString, why}` edits, one per concrete
       change. The worker uses `sendStructured` because we need
       schema-validated edits (not free-form Markdown).
    5. For each proposed edit: reads the target file, verifies
       `oldString` appears exactly once, replaces it with `newString`,
       writes back via `vscode.workspace.fs`. When the literal
       `oldString` does not match, applies a deterministic safety
       net of repairs (CRLF↔LF normalisation; stripping unified-diff
       `-`/`+` markers when the proposal copied a diff hunk verbatim;
       LF→CRLF when the file is CRLF). Empty `oldString` plus a
       non-existent target is treated as a create-mode edit. Reports
       per-edit success/failure (file missing, oldString not found,
       oldString ambiguous, file already exists for create-mode).
    6. Persists a debug log next to the source transcript at
       `<iso>-apply.json` containing the worker's raw edits and the
       per-edit outcomes, so failures are diagnosable after the fact.
    7. If `codecrosscheck.applyReview.testCommand` is set, runs the
       command in a VS Code terminal and streams a pass/fail summary
       (does not parse output).
    8. Emits a summary card listing applied edits, skipped edits with
       reasons, and (if test command ran) the exit code. Suggests
       `git diff` and a follow-up `/review-branch` to verify.
  - New setting `codecrosscheck.applyReview.testCommand` (string,
    default `""`). When non-empty, runs after edits in a terminal
    named `CodeCrossCheck: apply-review tests`. Empty disables the
    test step.
  - New setting `codecrosscheck.applyReview.dryRun` (boolean, default
    `false`). When `true`, the handler prints the planned edits and
    does NOT write to disk. Useful for validating proposals before
    committing to the apply step.

  - **`/review-branch` enhancements** (so `/apply-review` has a usable
    proposal to act on):
    - Repository file context: before each fixer iteration, the
      extension harvests workspace-relative paths from the reviewer's
      findings (`where`, `suggestion`) and from the worker's prior
      proposal, reads those files, and injects them into the fixer
      input as a `# Repository file context` section (capped at
      60 KB). The fixer prompt forbids the "Data I need: full current
      contents of …" dodge when the source is in that section. This
      stops the loop from terminating with a sketch when the cited
      file is outside the branch diff.
    - Worker disagreement adjudication: when the fixer writes
      `**Fix:** Disagree: …` for a reviewer finding, `/review-branch`
      surfaces the rebuttals as a numbered, blockquoted decision
      block at the end of the run. The user adjudicates between two
      runs by either (a) running `/apply-review` to accept the
      rebuttals (rebutted findings produce no edits, so nothing is
      applied) or (b) re-running `/review-branch` with `force-fix-all`
      in the prompt; the fixer is then told it MUST produce concrete
      fixes for every finding and MUST NOT rebut.
    - Blocked-finding detection: a complementary
      `parseBlockedFindings` helper flags issue sections where the
      worker dodged via prose ("Data I need", `(sketch — pending
      current source)`, "I cannot produce a patch") without using
      the explicit `Disagree:` token. These are rendered as a
      separate `🚫 N finding(s) the worker did not produce a real
      patch for` block with a remediation hint (open the parent
      multi-project folder as the workspace, or re-run with
      `force-fix-all`). Disagreement-captured issues are excluded
      to avoid double reporting.
    - Summary discoverability: the non-converged summary clarifies
      that residual reviewer findings target the **proposal**, not
      the original branch. Whenever a fix proposal exists
      (converged or not) the summary points the user at
      `/apply-review` so the patches in the proposal are not
      missed; the manual-only fallback only renders when no
      proposal exists.
    - Reviewer exhaustiveness: the reviewer prompt now requires
      every finding to be listed (high → low → file/line), no
      arbitrary cap. The fixer prompt now requires each round to be
      a complete, self-contained proposal — any hunk from round N
      that is still needed must be repeated in round N+1, since
      `/apply-review` consumes only the final round.
    - Per-invocation iteration cap: `/review-branch` accepts
      `max-iters=N` / `maxiters=N` / `iters=N` in the user prompt
      (whole-token, case-insensitive, range 1..20) to override
      `codecrosscheck.maxIters` for that run only.

## Impact

- Affected specs: `vscode-extension`.
- Affected code:
  - `src/extension.ts` — register `/apply-review` slash command and
    handler.
  - `src/applyReview.ts` (new) — transcript loader, edit derivation,
    edit application, summary rendering. Pure module so it can be
    tested without VS Code.
  - `src/prompts/apply_review_worker.md` (new) — system prompt for
    the apply worker.
  - `src/schemas.ts` — add `ApplyReviewSchema` (zod) for the
    `{edits: [...]}` structured output.
  - `package.json` — register `apply-review` in
    `contributes.chatParticipants[].commands`, add
    `codecrosscheck.applyReview.testCommand` and
    `codecrosscheck.applyReview.dryRun` settings.
  - `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md` — document
    the new command and recommended workflow
    (`/review-branch` → review proposal → `/apply-review` →
    `git diff` → commit → optional `/review-branch` re-check).
- Behavioral change: none for existing flows. `/apply-review` is a
  new entry point; everything else continues to work as-is.
- Security: the handler writes to the workspace and may run a
  user-configured shell command. Mitigations:
  - Path validation: every edit's `path` MUST resolve under the
    workspace root after `path.resolve`. Any path that escapes via
    `..` or absolute paths outside the workspace is rejected.
  - Exact-match constraint: an edit is applied only when its
    `oldString` appears exactly once in the target file. Zero matches
    or multiple matches abort that edit and surface a warning.
  - Dry-run setting: lets cautious users preview before committing.
  - Test command is opt-in (default empty) and runs in a visible
    VS Code terminal; output is not parsed for control sequences.
- No new external dependencies.
