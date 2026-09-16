# Tasks

## A. Single source of configuration
- [x] A1. Add `src/config.ts` exporting `DEFAULTS` and a
       `resolveClients(cfg, requestModel)` helper returning worker/reviewer
       clients plus a same-model warning flag.
- [x] A2. Replace all four inline model-resolution blocks in `src/extension.ts`
       with `resolveModels`.
- [x] A3. Align `maxIters` across manifest, `src/config.ts`, `src/cli.ts` and
       `.github/skills/codecrosscheck-delegate/SKILL.md`.
- [x] A4. Delete the dead `SLASH_TO_STAGE["review-branch"]` entry.
- [x] A5. Test asserting every `DEFAULTS` key matches the manifest's
       contributed default.

## B. Drop the artifact envelope
- [x] B1. Remove `WorkerOutputSchema`; make `buildWorker` call `sendText`.
- [x] B2. Rewrite the output-contract sections of `plan_worker.md`,
       `code_worker.md` and `execute_worker.md` to request plain output.
- [x] B3. Update `test/agents.test.ts` for the new worker contract.

## C. Informative retries
- [x] C1. Replace `schemaDescription` with a generated description derived from
       the zod schema.
- [x] C2. Include the failed response as an assistant turn and the validation
       error text in the retry messages, in both clients.
- [x] C3. Tests covering echo-of-failed-response and error inclusion
       (`test/retry.test.ts`; red-proofed by removing the assistant echo).

## D. Model discovery
- [x] D1. Remove the `enum` from `workerModel` / `reviewerModel` in the
       manifest; keep them as free-text strings.
- [x] D2. Fold `workerModelOverride` / `reviewerModelOverride` into the base
       settings, marking the old ones deprecated and still honoured.
- [x] D3. Add a `codecrosscheck.pickModels` command backed by
       `vscode.lm.selectChatModels`.
- [x] D4. Extend the no-match error to list available families.

## E. Modern chat surface
- [x] E1. Review the `engines.vscode` floor against the APIs used.
       **Outcome: no bump.** `ChatResult`, `followupProvider`, `stream.button`,
       `ChatRequest.references` and `LanguageModelChat.countTokens` are all
       available at the declared `^1.93.0` floor, so raising it would only
       shrink the supported range for no gain. The bump belongs with
       `replace-context-harvest-with-tools`, which needs the tool-calling API.
       **CORRECTION (2026-09-14, see `pin-vscode-api-floor`): this outcome was
       wrong.** The list above is accurate but omits `ChatRequest.model`, which
       this same change introduced and which only exists from VS Code 1.95.0.
       The floor is now `^1.95.0`. The check was done by reading an API list
       instead of compiling against the pinned floor, which is why it missed a
       call site in its own diff.
- [x] E2. Return `ChatResult` with `metadata` and `errorDetails` from every
       handler.
- [x] E3. Register a followup provider (apply, force-fix-all, raise cap).
- [x] E4. Emit `stream.button()` for `/apply-review` where it is recommended.
- [x] E5. Read `ChatRequest.references`, include their content in the prompt,
       name them in the response, and count them against the char budget.

## F. Prompt edition
- [x] F1. Name the OWASP Top 10 edition in `code_reviewer.md`; confirm which
       edition is current before pinning. **Verified against owasp.org: the
       current release is OWASP Top 10:2025 and 2021 is listed as a previous
       version.** The checklist was rewritten to the 2025 categories (A03 is now
       Software Supply Chain Failures, A10 is Mishandling of Exceptional
       Conditions, and SSRF is no longer standalone — an explicit note keeps it
       covered).
- [x] F2. Record the edition in the transcript. `reviewerOwaspEdition()` reads
       it back out of the prompt so the two cannot drift, and it is written to
       the `review-branch-start` event.

## G. Docs
- [x] G1. CHANGELOG entries for the breaking settings change.
- [x] G2. `openspec/project.md`: correct the contradictory `maxIters` defaults
       and the model-selection description.
- [x] G3. Update the delegation skill's settings table.
