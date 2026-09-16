# Change: update-default-model-pair

## Why

The declared default model pair is stale, and one surface contradicts the
spec outright.

`openspec/specs/chat-loop/spec.md` requires that the reviewer default is not
the same family as the worker default. `src/cli.ts` defaults **both**
`--worker-model` and `--reviewer-model` to `openai/gpt-5.4`, so the CLI ships
a same-model pair and the "Default model pair" requirement's CLI scenario is
false today. `README.md` documents that broken default rather than the
required one.

Separately, the VS Code defaults name older families than the ones now in
use. Because `codecrosscheck.useChatPickerWorker` defaults to `true`, the
worker in the chat participant already follows the Copilot Chat picker —
`codecrosscheck.workerModel` is only the fallback when the picker yields
nothing. The reviewer is always config-driven, so `codecrosscheck.reviewerModel`
is the setting that actually determines the cross-check.

## What Changes

- Default worker family becomes `anthropic/claude-opus-5`; default reviewer
  family becomes `openai/gpt-5.3-codex`. The pair stays cross-vendor, and the
  direction flips: the reviewer is now the OpenAI model.
- `src/cli.ts` stops defaulting both flags to the same family, restoring the
  cross-vendor invariant on the CLI surface.
- `package.json`, `src/config.ts`, `README.md`, `docs/ARCHITECTURE.md`,
  `openspec/project.md` and the delegation skill are updated in lockstep.
  `test/config.test.ts` already asserts manifest/DEFAULTS parity dynamically,
  so it needs no edit.

## Impact

- Affected specs: `chat-loop` (two requirements name the pair explicitly).
- Affected code: `package.json`, `src/config.ts`, `src/cli.ts`.
- Behavioural: anyone relying on the old defaults without setting the values
  explicitly gets a different reviewer. Pre-1.0, and both settings are free
  text, so no migration is provided.
- **Unverified:** the family strings `anthropic/claude-opus-5` and
  `openai/gpt-5.3-codex` were supplied by the user and have not been resolved
  against `vscode.lm.selectChatModels`. `stripVendor` passes the part after
  the slash as `family`; if it does not match, model selection fails. Confirm
  with the **CodeCrossCheck: Pick Worker and Reviewer Models** command.
- The CLI's runtime backend is separately broken: GitHub Models was retired on
  2026-07-30. Correcting the CLI defaults here restores spec conformance but
  does not make the CLI functional. That is left to its own change.
