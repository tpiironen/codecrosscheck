# AGENTS.md

Instructions for AI coding agents working in this repository.

## Spec-driven workflow (mandatory)

1. **No code change starts without an approved OpenSpec proposal.** If the user asks for an implementation that does not yet have a change under `openspec/changes/`, propose one first.
2. Before writing code for an existing change, run `openspec validate <change-id> --strict` and confirm it passes.
3. Implement strictly what `tasks.md` lists. Touching files outside the listed scope is a defect — surface it back to the user before proceeding.
4. After all tasks are done, run `openspec archive <change-id>` to merge the delta into `openspec/specs/<capability>/spec.md`.

## Current state

The bootstrapping change `add-codecrosscheck`, which introduced all six capabilities at once, was archived on 2026-09-11. Every change since has followed the one-capability-per-change pattern, and all new work MUST continue to.

One change sits permanently under `openspec/changes/`: **`add-sha256-cli`**. It is a test fixture, not a feature — `scripts/selftest-openspec.mjs` pins it by id as the live target of `npm run selftest:openspec`. Never implement, archive or delete it.

## Capability ownership

When deciding which spec a new requirement belongs to, use this routing:

| Topic | Capability |
|---|---|
| Loop control flow, ChatClient adapters, sandbox, CLI | `chat-loop` |
| Reviewer prompt content, verdict schema | `prompts` |
| `@codecrosscheck` chat participant, slash commands, VS Code settings | `vscode-extension` |
| Tests, fake clients, cross-platform gates | `verification` |
| Repository hosting, release gate, packaging and install path | `distribution` |
| `--openspec` flag, validate pre-gate, `/openspec` commands | `openspec-integration` |

## Implementation conventions

- TypeScript strict mode. No `any` without an inline justification comment.
- Reviewer responses are zod-validated. Never bypass the schema.
- Path handling: `node:path` + `node:url`. Never assume forward slashes.
- Subprocess invocations: `child_process.spawn` with explicit `cwd`, scrubbed `env`, and a hard timeout. Never `exec` a string.
- Tests for new behavior live alongside the change in `test/` and use a fake `ChatClient` unless `RUN_LIVE_TESTS=1`.

## Self-hosting

Once `add-codecrosscheck` is archived, every subsequent change SHOULD be reviewed by CodeCrossCheck itself before implementation:

```bash
codecrosscheck --openspec <change-id> --stages plan
```

This dogfoods the tool and catches scope creep early.

## What NOT to do

- Don't add agent frameworks (LangGraph, AutoGen, MAF). The loop is intentionally framework-free.
- Don't introduce Python — this is a pure-TS codebase.
- Don't publish to any registry. Distribution is local-only: build from a clone, package with `vsce`, install the `.vsix`. `package.json` sets `"private": true` — don't remove it without a `distribution` change that says what replaces it.
- Don't bypass the sandbox in EXECUTE; route all generated code execution through `src/sandbox.ts`.
