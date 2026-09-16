# Change: pin-vscode-api-floor

## Why

`engines.vscode` declared `^1.93.0`, but `@types/vscode` was declared `^1.93.0`
too — and a caret on a `1.x` version accepts any later minor, so it resolved to
**1.116.0**. Every typecheck validated the code against an API surface 23 minor
versions newer than the range we advertise. The compatibility claim was
unenforced.

It was also false. Pinning the typings to `~1.93.0` produced four errors:

    src/extension.ts(158,101): Property 'model' does not exist on type 'ChatRequest'.
    src/extension.ts(431,90):  Property 'model' does not exist on type 'ChatRequest'.
    src/extension.ts(831,64):  Property 'model' does not exist on type 'ChatRequest'.
    src/extension.ts(1296,101): Property 'model' does not exist on type 'ChatRequest'.

`ChatRequest.model` was introduced in **VS Code 1.95.0** (verified by fetching
the typings for 1.94 through 1.98 and testing for the declaration; 1.94 lacks
it, 1.95 has it). Because `codecrosscheck.useChatPickerWorker` defaults to
`true`, on VS Code 1.93 or 1.94 `request.model` is `undefined` and the
picker-as-worker feature silently does nothing — no error, just a fallback to
the configured model.

The `modernize-chat-surface` change reviewed this and recorded "Outcome: no
bump", listing `ChatResult`, `followupProvider`, `stream.button`,
`ChatRequest.references` and `LanguageModelChat.countTokens` as available at
1.93. That list is correct but incomplete: it omits `ChatRequest.model`, which
the same change set introduced. The review was performed by reading the API
list rather than by compiling against the declared floor, which is exactly why
it missed one.

## What Changes

- `engines.vscode` and the `vscode` peer dependency become `^1.95.0`.
- `@types/vscode` becomes `~1.95.0`, so the typings track the declared floor
  and cannot silently drift past it again.
- `CONTRIBUTING.md` states 1.95+.
- Task E1 of `modernize-chat-surface` is annotated with the correction rather
  than quietly edited, so the audit trail survives.

## Impact

- Affected specs: `distribution` (new requirement encoding the invariant that
  the declared floor must be the one typecheck validates against).
- Affected code: `package.json`, `package-lock.json`, `CONTRIBUTING.md`.
- Users on VS Code 1.93 or 1.94 can no longer install the extension. That is
  the correct outcome: it did not fully work for them, it merely failed
  quietly.
- Typecheck now enforces the compatibility claim instead of assuming it. Any
  future use of a post-1.95 API becomes a build error rather than a silent
  runtime no-op on the minimum supported version.
