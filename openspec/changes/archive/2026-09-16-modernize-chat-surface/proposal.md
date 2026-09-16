# Modernize the chat surface and prompt contracts

## Why

Several parts of the extension are scaffolding built around 2024-era model and
API limitations that no longer hold, and they now cost more than they save.

**Duplicated, drifting configuration defaults.** The four-line model-resolution
incantation appears verbatim four times in `src/extension.ts`. It has already
drifted: `handleReviewBranch` falls back to `"openai/gpt-5.4"` for the
*reviewer*, while the other three sites fall back to `"claude-opus-4.6"` — so
the fallback for the deliberately cross-vendor reviewer is the worker's
vendor. `maxIters` is `6` in the manifest, `?? 3` in every code fallback, `3`
in the CLI, and `3` in the delegation skill's settings table.
`SLASH_TO_STAGE["review-branch"]` is dead, because `review-branch` returns
before `stages` is read.

**A JSON envelope around Markdown.** `plan_worker.md` and `code_worker.md`
require `{"artifact": "<markdown or code>"}`, forcing the model to JSON-escape
an entire document into one string field. That costs tokens, invites escaping
errors, and pushes otherwise-fine responses into the two-strike retry path.
`review_branch_fixer` already returns plain Markdown through `sendText` and
does not need the envelope.

**A retry that withholds the evidence.** On a parse failure both clients append
only a schema reminder. The model's own failed response and the validation
error are omitted, so it cannot see what it did wrong. Worse,
`schemaDescription()` returns `schema.description ?? "the previously stated
structured-verdict schema"`, and neither `VerdictSchema` nor
`ApplyReviewSchema` carries a description — so the `vscode.lm` retry message
is literally content-free.

**A hand-maintained model list.** The manifest hardcodes fifteen model families
twice. The `workerModelOverride` / `reviewerModelOverride` free-text settings
already exist as an escape hatch, which is direct evidence that the enum rots
faster than releases ship.

**An old API floor and unused chat affordances.** `engines.vscode` is pinned at
`^1.93.0` while `@types/vscode` resolves far newer. The handler returns
`undefined` instead of a `ChatResult`, offers no followups, renders "re-run
this command with `force-fix-all`" as prose the user must retype, exposes no
button for the `/apply-review` step it explicitly recommends, and discards
`request.references` entirely — so files a user attaches to the chat are
silently ignored.

## What Changes

- **MODIFIED capability `vscode-extension`**: configuration resolution SHALL
  live in one module with one declared default per setting, shared by every
  handler and consistent with the manifest.
- **MODIFIED capability `prompts`**: workers that produce Markdown or code
  SHALL return it as plain text. The `{"artifact": …}` envelope SHALL be
  removed.
- **MODIFIED capability `chat-loop`**: the structured-output retry SHALL show
  the model its own failed response and the validation error, and the schema
  reminder SHALL carry the actual schema.
- **MODIFIED capability `vscode-extension`**: model families SHALL be
  discovered from `vscode.lm` rather than enumerated in the manifest.
- **MODIFIED capability `vscode-extension`**: handlers SHALL return a
  `ChatResult`, offer followups, expose the recommended next step as a button,
  and incorporate files the user attached to the request.
- **MODIFIED capability `prompts`**: the reviewer checklist SHALL name the
  OWASP Top 10 edition it applies, and that edition SHALL be recorded in the
  verdict so a review is auditable.

## Impact

- Affected specs: `vscode-extension`, `prompts`, `chat-loop`.
- Affected code: new `src/config.ts`, `src/extension.ts`, `src/agents.ts`,
  `src/clients/*.ts`, `src/prompts/*.md`, `package.json`.
- Affected tests: `test/agents.test.ts`, `test/refusal.test.ts`,
  `test/oversized.test.ts`, new config tests.
- User-visible change: model settings become free-text with a picker command;
  chat responses gain followups and an Apply button; attached files are used.
- **Breaking**: the `workerModel` / `reviewerModel` enums are removed in favour
  of free text. Existing values remain valid. `workerModelOverride` and
  `reviewerModelOverride` are deprecated and folded into the base settings.
