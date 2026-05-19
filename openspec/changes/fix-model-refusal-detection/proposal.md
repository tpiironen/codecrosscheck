# Detect content-policy refusals in structured LM responses

## Why

Live `/code` runs on the `nonconformance-infor-text-blocks` OpenSpec change
surfaced a confusing failure mode. The worker (vscode.lm Copilot model)
returned a content-policy refusal — `Sorry, I can't assist with that.` — but
the user saw:

```
vscode.lm response failed schema "WorkerOutput" twice.
  First:  Unexpected token 'S', "Sorry, I c"... is not valid JSON.
  Retry:  Unexpected token 'e', "text\nSorry"... is not valid JSON.
```

Two distinct defects compound here:

1. **Blind schema-reminder retry on a refusal.** A model that refuses on
   attempt 1 will refuse on attempt 2 — the retry never recovers, but the
   user sees two parse errors that look unrelated and burns reviewer tokens
   in the meantime.
2. **Lenient fence regex hides the refusal.** `extractJson` in
   `src/clients/vscodeLm.ts` uses `/```(?:json)?\s*([\s\S]*?)```/`. On the
   retry the model wrapped its refusal in a ``` ```text ``` ``` fence; the
   `(?:json)?` group matched empty, `\s*` then consumed past the unknown
   `text` tag, and the captured group `text\nSorry, I can't...` was fed
   straight into `JSON.parse`. The user got a misleading
   `Unexpected token 'e', "text\nSorry"...` instead of seeing the refusal.

## What Changes

This change extends one existing capability and introduces no new ones.

- **`chat-loop`** (extended)
  - `VscodeLmClient.sendStructured` and `GithubModelsClient.sendStructured`
    SHALL inspect each raw response (initial and retry) for a content-policy
    refusal pattern *before* JSON parsing. When detected, they SHALL throw a
    new `ModelRefusalError` (exported from `src/clients/vscodeLm.ts`) that
    carries the model id and a truncated snippet of the response. The retry
    path SHALL be skipped — a refusal on attempt 1 cannot be cured by a
    schema reminder on attempt 2.
  - `extractJson` SHALL only unwrap fences whose opening line is either
    ```` ```json ```` or unlabelled (``` ``` ``` ```), and the opener SHALL
    be followed by a newline. Unknown language tags (``` ```text ```,
    ``` ```yaml ```) SHALL NOT be silently stripped.
  - The fallback two-strike error (when both attempts produce non-refusal
    junk) SHALL include a 160-char snippet of each raw response, so users
    can see what the model actually said without trawling the transcript.

## Impact

- Affected specs: `chat-loop`.
- Affected code:
  - `src/clients/vscodeLm.ts` — new `ModelRefusalError`, `assertNotRefusal`
    helper, tightened `extractJson`, refusal short-circuit in
    `sendStructured`.
  - `src/clients/githubModels.ts` — imports and uses the same refusal
    check.
  - `test/refusal.test.ts` — 5 new vitest cases covering plain prose
    refusal, fenced refusal, alternate "I'm unable to" phrasing, false
    positive guard (valid JSON containing the word "sorry"), and a
    non-refusal unknown-fence prose case that must NOT be unwrapped into
    `JSON.parse`.
- No breaking change to public APIs. The new error class is additive; all
  existing callers (loop, pipeline, applyReview) catch via `catch (err)` and
  surface `err.message`, so they will now show a clear "Model refused" line
  in chat instead of a misleading JSON-parse string.
- No new dependencies. No new VS Code settings.
