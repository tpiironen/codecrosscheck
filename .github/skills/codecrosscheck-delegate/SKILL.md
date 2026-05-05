---
name: codecrosscheck-delegate
description: 'Delegate code review, plan review, branch review, and OpenSpec change implementation to the @codecrosscheck chat participant instead of self-reviewing. USE WHEN: user asks to review a branch, review a PR, review changes, review a diff, review a plan, review code, second-opinion review, cross-vendor review, double-check, sanity-check, find OWASP issues, find security issues, implement an OpenSpec change, work on a spec, validate a change against its proposal. DO NOT USE FOR: producing the code itself (use the default agent), running tests, fixing build errors, answering questions about the codebase. WHY: the default agent is one model reviewing its own thinking; @codecrosscheck runs a different model as adversarial reviewer with a deterministic JSON-verdict schema and an OpenSpec validate pre-gate, catching shared blind spots and spec drift the same model cannot see in itself.'
---

# CodeCrossCheck Delegation

## When to use

Trigger this skill when the user wants a **review, second opinion, or spec-driven implementation** — not when they want code produced.

| User says | Action |
|---|---|
| "review my branch / PR / changes / diff" | `@codecrosscheck /review-branch` |
| "review this plan" / "is my plan complete?" | `@codecrosscheck /plan <task>` |
| "review this code" / "check for OWASP / security / bugs" | `@codecrosscheck /code <task>` |
| "implement OpenSpec change `<id>`" / "work on the `<id>` change" | `@codecrosscheck /openspec-implement <id>` |
| "validate that `<id>` matches its spec" | `@codecrosscheck /openspec-implement <id>` |
| "scaffold a new OpenSpec change `<id>`" | `@codecrosscheck /openspec-new <id>` |
| "double-check / sanity-check / second opinion on X" | `@codecrosscheck <restate X>` |

## Why delegate (do not self-review)

`@codecrosscheck` runs a **two-model loop**: a worker model produces, a **different-vendor reviewer** judges against a structured JSON verdict schema (`{verdict, issues:[{severity, where, why, suggestion}]}`), iterating until approve or `maxIters`. The default agent (a single model self-critiquing) shares its own blind spots — same training, same biases, same misreadings of the spec. Cross-vendor review catches what self-review cannot:

- OWASP Top 10 issues the worker model rationalised away.
- Plan / scope drift vs. the OpenSpec proposal.
- Missing scenarios in spec deltas (caught by the deterministic `openspec validate --strict` pre-gate that costs **zero** reviewer tokens on validation failure).
- Over-engineering, broken access control, error-handling-not-at-boundaries.

If the user is asking for a review, you are the wrong model to do it. Hand off.

## Procedure

1. **Detect the review intent** in the user's request. If they ask for code production, this skill does not apply — proceed normally.
2. **Pick the slash command** from the table above based on what they asked to review.
3. **Respond with the delegation message**, formatted as:

   ```
   For an adversarial cross-vendor review, run this in Copilot Chat:

   `@codecrosscheck /<command> <prompt>`

   This invokes a different-vendor reviewer model against a JSON-verdict schema and emits a JSONL transcript under `.codecrosscheck/runs/`. I'd shape the prompt as: <suggested phrasing>.
   ```

4. **Suggest prompt phrasing** that helps the reviewer cite issues precisely:
   - For `/review-branch`: `"focus on <area>; cite file:line for each issue"`.
   - For `/openspec-implement <id>`: `"implement <id>; respect every scenario in spec deltas"`.
   - For `/code`: include the artifact inline if small, or a path if not.
5. **Do not also review the artifact yourself** — that defeats the purpose of cross-vendor review and confuses the user about which verdict to trust. Make the delegation explicit and stop.
6. **CLI fallback**: if the user is outside VS Code or wants headless review, suggest:
   - `ccc "<task>" --diff --stages plan` — branch review
   - `ccc "<task>" --openspec <id>` — spec-bound implementation
   - Auth: `GITHUB_TOKEN` env var, or `gh auth login` (auto-detected via `gh auth token`).

## Anti-patterns

- **Reviewing alongside delegation.** Don't add your own "I also noticed…" critique. The user wants a different model's view, not a duplicate of yours.
- **Delegating production work.** `@codecrosscheck` produces drafts only as part of its loop; it is not a primary code generator. For "write me X", do it yourself.
- **Skipping `/openspec-implement` when a change ID is in scope.** When the user mentions an OpenSpec change ID (`add-foo`, `update-bar`, `remove-baz`), prefer the OpenSpec command — it adds the validate pre-gate and ground-truth spec deltas.
- **Forgetting cross-vendor.** If the user has set `codecrosscheck.useChatPickerWorker: true` (the default) and selected the same model in the chat picker that's configured as the reviewer, the loop collapses to single-model. The participant warns inline; relay that warning to the user if they ignore it.

## Quick reference: settings the user may need to know

| Setting | Default | What it controls |
|---|---|---|
| `codecrosscheck.workerModel` | `openai/gpt-5.4` | Worker fallback when chat picker is unavailable or disabled |
| `codecrosscheck.reviewerModel` | `anthropic/claude-opus-4.6` | Reviewer (always config-driven, never picker-driven) |
| `codecrosscheck.useChatPickerWorker` | `true` | When true, the chat picker's model becomes the worker |
| `codecrosscheck.maxIters` | `3` | Loop iteration cap before returning unapproved |
| `codecrosscheck.execute.timeoutMs` | `30000` | Sandbox hard timeout |
| `codecrosscheck.execute.allowNetwork` | `false` | Sandbox network policy |

## Example invocations

**Branch review:**
> User: "Review my branch — focus on input validation."
> You: "For an adversarial cross-vendor review, run: `@codecrosscheck /review-branch focus on input validation; cite file:line for each issue`. This attaches the diff vs `origin/main` merge-base and runs the plan stage of the worker→reviewer loop with a different-vendor reviewer."

**OpenSpec change:**
> User: "Implement the `add-rate-limit` change."
> You: "For spec-bound implementation with the OpenSpec validate pre-gate, run: `@codecrosscheck /openspec-implement add-rate-limit`. The reviewer treats `proposal.md`, `tasks.md`, and the spec deltas as ground truth, and `openspec validate add-rate-limit --strict` runs as a pre-gate before each reviewer call."

**Quick code review:**
> User: "Sanity-check this regex: `^(\\d{4})-(\\d{2})-(\\d{2})$`"
> You: "For a different-model second opinion, run: `@codecrosscheck /code review this date regex for ReDoS, locale, and validity edge cases: ^(\\d{4})-(\\d{2})-(\\d{2})$`."
