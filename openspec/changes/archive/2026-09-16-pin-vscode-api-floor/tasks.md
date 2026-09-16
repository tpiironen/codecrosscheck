# Tasks: pin-vscode-api-floor

- [x] 1.1 Change `@types/vscode` from `^1.93.0` to a tilde range so it cannot
      resolve past the declared floor.
- [x] 1.2 Typecheck against the pinned floor and record what breaks.
      — 4 errors, all `ChatRequest.model`.
- [x] 1.3 Determine the first VS Code version providing `ChatRequest.model`.
      — 1.95.0; verified against typings for 1.94 (absent) and 1.95 (present).
- [x] 1.4 Raise `engines.vscode` and the `vscode` peer dependency to `^1.95.0`,
      and set `@types/vscode` to `~1.95.0`.
- [x] 1.5 Re-run typecheck against the new floor. — clean.
- [x] 1.6 Update `CONTRIBUTING.md` to state VS Code 1.95+.
- [x] 1.7 Annotate task E1 of `modernize-chat-surface` with the correction.
- [x] 1.8 Run lint, typecheck, the full suite, package the VSIX, and
      `npx openspec validate pin-vscode-api-floor --strict`.
      — all green; VSIX packaged (59 files, 513.13 KB).
