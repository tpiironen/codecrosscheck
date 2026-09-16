# Tasks: fix-model-refusal-detection

All tasks below are complete; this change documents the work that landed in
the session triaging a confusing `/code` failure on the
`nonconformance-infor-text-blocks` change.

## A. Refusal detection

- [x] A1. Add `ModelRefusalError extends Error` to
  `src/clients/vscodeLm.ts` with `modelId`, `raw` fields and a message
  that includes a snippet of the response and remediation guidance.
- [x] A2. Add `assertNotRefusal(raw, modelId)` helper exported alongside
  `ModelRefusalError`. Match a small set of conservative regexes
  anchored to the start of the response (after an optional ``` ``` fence
  opener) so legitimate JSON containing the word "sorry" is not flagged.
- [x] A3. Call `assertNotRefusal` before `JSON.parse` on both the initial
  attempt and the retry inside `VscodeLmClient.sendStructured`. When a
  refusal is detected on the initial attempt, skip the retry and rethrow.
- [x] A4. Import and apply the same refusal check from
  `src/clients/githubModels.ts` so both transports behave identically.

## B. Fence regex hardening

- [x] B1. Tighten `extractJson` to `/```(?:json)?\r?\n([\s\S]*?)```/` so
  unlabelled and `json`-labelled fences are still unwrapped, but
  unknown tags (`text`, `yaml`, ...) are left intact and fall through to
  the brace-pair fallback / raw-trim path. This stops the bug where a
  ``` ```text ``` refusal was silently stripped into `text\nSorry...`.

## C. Diagnostic improvement

- [x] C1. Include a 160-char `snippet(raw)` of each attempt's raw
  response in the two-strike fallback error message. Whitespace is
  collapsed so the snippet stays one line in chat.

## D. Tests

- [x] D1. Add `test/refusal.test.ts` mocking the `vscode` module via
  `vi.mock` and stubbing a `LanguageModelChat` with a fixed text stream.
- [x] D2. Cover: plain-prose refusal, ``` ```text ``` fenced refusal,
  `I'm unable to comply` phrasing, false-positive guard
  (`{"artifact":"sorry that was confusing"}` is parsed as valid), and an
  unknown-fence non-refusal prose case that must throw the two-strike
  error rather than silently `JSON.parse` the fence contents.

## E. Verification

- [x] E1. `npm run build` clean.
- [x] E2. `npx vitest run` — 78 passed / 8 skipped (5 new + 73 existing).
