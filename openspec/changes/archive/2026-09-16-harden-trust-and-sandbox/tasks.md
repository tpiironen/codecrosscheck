# Tasks

## A. Setting scope and trust declaration
- [x] A1. Add `"scope": "machine"` to `codecrosscheck.applyReview.buildCommand`
       and `codecrosscheck.applyReview.testCommand` in `package.json`.
- [x] A2. Add a top-level `capabilities.untrustedWorkspaces` entry with
       `supported: false` and a description naming command execution and
       workspace writes.
- [x] A3. Gate the build gate and the test terminal in `handleApplyReview` on
       `vscode.workspace.isTrusted`, with an explicit chat message when skipped.

## B. Sandbox honesty
- [x] B1. Remove the `NO_PROXY` / `no_proxy` assignment and the `allowNetwork`
       option from `src/sandbox.ts` and `SandboxOptions`.
- [x] B2. Remove the `codecrosscheck.execute.allowNetwork` setting and its
       reads in `src/extension.ts`; remove `--allow-network` from `src/cli.ts`.
- [x] B3. Update the `execute.timeoutMs` description to state that generated
       code runs with the invoking user's filesystem privileges.
- [x] B4. Add a `test/sandbox.test.ts` case asserting the child environment
       contains no sandbox-introduced `NO_PROXY`.
- [x] B5. Comment `runBuildGate` explaining why `exec` is used and recording
       that the command source is machine-scoped.

## C. Transcript containment
- [x] C1. Write a `.gitignore` containing `*` into `.codecrosscheck/` when the
       transcript directory is created.
- [x] C2. Prune transcripts beyond a retention limit, oldest first.
- [x] C3. Unit-test the pruning helper against a fake filesystem.
- [x] C4. Rewrite `findLatestTranscript` to inspect the tail and match a parsed
       terminating event instead of substring-scanning whole files.
- [x] C5. Make transcript event writes asynchronous and serialised.
- [x] C6. Test that an artifact quoting the event name is not selected.

## D. Webview hardening
- [x] D1. Pass `localResourceRoots: []` to `createWebviewPanel`.
- [x] D2. Emit a `default-src 'none'; style-src 'unsafe-inline'` CSP meta tag.
- [x] D3. Rename the local `escape` helper so it does not shadow the deprecated
       global.

## E. Docs
- [x] E1. CHANGELOG entries under `Security` and `Removed`.
- [x] E2. `openspec/project.md`: correct the sandbox description.
- [x] E3. `README.md` / `docs/ARCHITECTURE.md`: remove `allowNetwork` references.
