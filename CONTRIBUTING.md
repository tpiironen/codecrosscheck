# Contributing to CodeCrossCheck

Thanks for your interest! This project is intentionally small and
auditable — please keep changes focused.

## Development setup

```powershell
npm ci
npm run build
npm test
```

- **Node**: 20+
- **VS Code**: 1.93+ (only needed for extension work)
- Press **F5** in VS Code to launch an Extension Development Host with
  the chat participant loaded.

## Workflow

1. Fork the repo and create a topic branch off `main`.
2. Make your change. Keep diffs focused — see the dogfood rule below.
3. Run `npm run build && npm test` locally.
4. Open a PR against `main`. The CI workflow runs build + tests on
   Windows and Linux.
5. Reviewers may run `@codecrosscheck /review-branch` against your PR
   diff (see below).

## Dogfood rule

This repository **is** the CodeCrossCheck extension. After making any
non-trivial code change, run the tool on your own branch before asking
for review:

```
@codecrosscheck /review-branch
```

If the reviewer returns `revise`, run `/apply-review` to land the
proposed patches, then re-build and re-test. Only after `approve` (or
explicit adjudication of each disagreement) should you push.

Exemptions: pure documentation changes (README, CHANGELOG,
ARCHITECTURE, OpenSpec proposals), one-line typo fixes, and trivial
mechanical edits.

The full rule lives in [`.github/copilot-instructions.md`](.github/copilot-instructions.md).

## Code style

- TypeScript strict mode. No `any` without an explicit comment.
- No new helpers or abstractions for one-time operations.
- No docstrings, comments, or type annotations on code you didn't
  change.
- Error handling at system boundaries only — no defensive try/catch
  around inner pure functions.
- New behaviour must come with a test (Vitest, in `test/`).

## OpenSpec

Substantial behavioural changes go through OpenSpec:

```
@codecrosscheck /openspec-new <change-id>
# edit openspec/changes/<change-id>/{proposal,tasks,specs/...}
openspec validate <change-id> --strict
```

See [`openspec/AGENTS.md`](openspec/AGENTS.md) and
[`openspec/project.md`](openspec/project.md).

## Reporting issues

Use [GitHub Issues](https://github.com/tpiironen/codecrosscheck/issues).
For security vulnerabilities, see [`SECURITY.md`](SECURITY.md) instead.
