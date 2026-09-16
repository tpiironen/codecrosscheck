# Replace regex context harvesting with model tool calls

> **Status: implemented, pending archive.** See `tasks.md`; E2 (corpus
> before/after) is deliberately still open and needs a live model run.

## Why

A large fraction of this codebase exists to work around a limitation that no
longer applies: that the model could not ask for a file.

`/review-branch` currently regex-scrapes candidate file paths out of prose
(`harvestPathsFromText`), resolves them by progressively stripping leading path
segments until one exists (`resolveReferencedPath`), reads them, concatenates
the results into a 60,000-character "Repository file context" block
(`buildFileInventory`), truncates that block when it overflows — and then uses
*further* regexes to detect that the worker dodged anyway
(`parseBlockedFindings`, matching English phrases such as
`/pending (?:the )?(?:current )?source/i` and
`/\*\*Data I need(?: to produce the patch)?[:\*]/i`). The longest paragraph in
`review_branch_fixer.md` is spent forbidding the model from inventing
identifiers it was not given.

Every one of those layers is compensation for a missing capability. Each also
carries its own defects:

- `harvestPathsFromText` matches against a hardcoded extension allowlist, so
  `.vue`, `.php`, `.tf`, `.swift`, `Dockerfile` and every extensionless file
  are silently invisible to the fixer.
- The dodge detectors are English-phrase regexes with obvious false positives;
  `pending source` appears in ordinary prose.
- Truncating the inventory at a character cap drops files without telling the
  model which ones it lost.

The same reasoning applies to the `/review-branch` → `/apply-review` split.
That two-command, two-model hop exists because prose could not be trusted to
carry exact strings, so a second model re-reads the first model's Markdown and
re-derives `oldString`/`newString` from it. `apply_review_worker.md` spends
sixty lines explaining how to translate a unified diff into an exact-match
edit, and `buildOldStringCandidates` / `repairNewStringFor` /
`stripDiffMarkers` are roughly ninety lines of CRLF-and-marker guesswork with a
combinatorial pairing rule, all to recover from the lossy round trip.

Given tool calling, the worker fetches exactly what it needs and emits edits
directly. The compensating machinery becomes deletable.

## Measured evidence: no pre-computed heuristic can close this gap

From the dogfood run of 2026-09-16
(`C:\src\AI-review\.codecrosscheck\runs\2026-09-16T07-38-59-138Z.jsonl`).
A single reviewer finding cited `src/extension.ts`. The triager needed
`src/applyReview.ts` to judge it, that file was absent, and the triager returned
`uncertain`; the run ended `defended` with nothing fixed.

Two candidate heuristics were evaluated against that run and both were rejected
on evidence, not preference:

- **Symbol-directed harvesting** (resolve identifiers named in the finding to
  their defining file) **would have failed.** Every identifier the finding named
  — `handleApplyReview`, `workspaceEditHost.commit`, `nodeFsLike` — is defined
  in `src/extension.ts` itself. Nothing in the finding text points outside it.
- **One-hop import-closure harvesting would have worked but is a net loss.**
  `extension.ts`'s local closure is 10 files / 58,241 chars; with the file
  itself that is 121,671 against a 60,000 budget. Fair-share allocation then
  cuts `extension.ts` from 30,586 to 15,587 chars and makes `applyReview.ts`
  partial at 15,586, while 8 files nobody asked about consume the remaining
  ~29k. It buys the needed file by halving the legibility of both files that
  mattered.

Both fail for one reason: the need for `applyReview.ts` was **discovered during
reasoning**, when the triager realised `w.content`'s provenance was decided in
another file. It was never stated in the finding. No amount of pre-computation
can extract information the source text does not contain — only letting the
model ask can.

## What Changes

- **MODIFIED capability `chat-loop`**: `ChatClient` SHALL support tool
  declaration and a tool-call round trip, so an agent can request data mid-turn.
- **ADDED capability `chat-loop`**: a workspace-reading toolset — read file,
  search, list directory — SHALL be exposed to worker and reviewer agents,
  confined to the workspace root and subject to a per-run call budget.
- **MODIFIED capability `vscode-extension`**: `/review-branch` SHALL stop
  pre-injecting harvested file context and SHALL let the worker request files.
  `harvestPathsFromText`, `resolveReferencedPath`, `buildFileInventory`, the
  file-context cap, and `parseBlockedFindings` SHALL be removed.
- **MODIFIED capability `vscode-extension`**: the fixer SHALL emit structured
  edits directly, so `/apply-review` no longer re-derives them from Markdown.
  `apply_review_worker.md`, `buildOldStringCandidates`, `repairNewStringFor`
  and `stripDiffMarkers` SHALL be removed. `/apply-review` SHALL remain as the
  user-confirmation checkpoint over already-structured edits.
- **MODIFIED capability `prompts`**: the grounding rules in
  `review_branch_fixer.md` that exist to prevent hallucinated identifiers SHALL
  be reduced to what tool access does not already guarantee.

## Impact

- Affected specs: `chat-loop`, `vscode-extension`, `prompts`.
- Affected code: `src/clients/*.ts`, `src/agents.ts`, `src/applyReview.ts`,
  `src/extension.ts`, `src/prompts/*.md`, new toolset module.
- Net effect is expected to be a substantial deletion rather than an addition.
- **Depends on** `modernize-chat-surface` for the raised `engines.vscode` floor
  and the consolidated configuration module.
- **Risks**: tool-call loops can fail to terminate — a call budget and a
  per-run deadline are required; a worker granted read access can pull secrets
  into a prompt, so the toolset must respect ignore files and refuse paths
  outside the workspace root; and the GitHub Models CLI transport must reach
  parity with the in-editor transport or the CLI regresses.
