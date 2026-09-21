# Change: selective-apply-review

## Why

`/apply-review` is all-or-nothing. `handleApplyReview` reads the stored
proposal, calls `editsFrom(stored.proposal)` — which flattens every fix's edits
into one list — and applies the lot:

```ts
const edits = editsFrom(stored.proposal);
...
const outcomes: ApplyOutcome[] = await applyEdits(ws, edits, nodeFs, { dryRun: cfg.dryRun, host: workspaceEditHost() });
```

The only controls are `codecrosscheck.applyReview.dryRun`, which is equally
all-or-nothing, and `force-fix-all`, which pushes in the opposite direction by
bypassing triage.

This leaves the workflow with no way to say "yes to this finding, no to that
one". Today a user who disagrees with one of five fixes has three options, and
all of them are bad: apply all five and revert one by hand; apply none and
re-run `/review-branch` in the hope of a different verdict; or copy the edits
out of the proposal manually. The first is the one people actually take, which
means a fix the user judged wrong lands in the working tree and has to be
unpicked from a diff that also contains four they wanted.

The project's own recorded position is that this matters: the reviewer "is not
right all of the time". Triage already encodes it on the *inbound* side — a
finding the worker cannot support never becomes an edit. There is no equivalent
on the outbound side, where the human, not the worker, is the judge.

The data needed already exists and requires no new model call. `FixSchema`
carries `findingId`, `status` and `edits`, and `VerdictSchema` carries the
matching findings with `severity`, `where` and `why`. Selection is a filter
over structure that is already parsed and already stored.

## What Changes

- `/apply-review` SHALL let the user choose which findings' edits to apply
  before anything is written, defaulting to all of them so the existing
  one-keystroke path is unchanged for anyone who wants everything.
- Selection is presented as a multi-select `QuickPick`, one entry per fix with
  status `fixed`, labelled with the finding's severity and `where` and detailed
  with its `why` and edit count. The `codecrosscheck.pickModels` command
  already establishes QuickPick as the extension's selection affordance.
- A headless directive — `/apply-review only <id,id>` and
  `/apply-review skip <id,id>` — SHALL select the same set without opening a
  picker, so the behaviour is testable without an extension host and usable
  from a script. The directive, when present, SHALL suppress the picker.
- Cancelling the picker SHALL apply nothing and SHALL NOT be reported as a
  failure, matching how cancellation is treated elsewhere.
- The apply log (`*-apply.json`) SHALL record which findings were selected and
  which were declined, so a later run can tell "not applied" from "declined".
- Dry-run continues to apply to whatever was selected.
- Findings whose status is not `fixed` carry no edits and SHALL NOT appear in
  the picker. They are already reported separately.

## Alternatives considered

- **Per-finding chat buttons.** Rejected: a proposal with eight findings would
  emit sixteen buttons into the transcript, and the chat surface has no
  affordance for "apply the ones I ticked" as a single action.
- **Applying everything and offering an undo.** Rejected: the edits land in a
  working tree that may already be dirty, so undo cannot be scoped reliably.
  Not writing an edit is cheaper than reliably removing one.
- **A new model call to re-draft without the rejected findings.** Rejected:
  it spends tokens to reproduce a subset the structured proposal already has,
  and it can change edits the user had already approved.

## Impact

- Affected specs: `vscode-extension` (one new requirement; the existing
  `/apply-review` requirement is untouched because selection precedes it).
- Affected code: `src/extension.ts` (`handleApplyReview` and directive
  parsing), `src/applyReview.ts` (a selection filter over `FixProposal`).
- No change to `FixProposalSchema`, to any prompt, or to the review loop. No
  additional model call — selection is a filter over stored structure.
- Risk: the picker is a new interactive step on a path that currently runs to
  completion unattended. The directive path and a "select all" default keep the
  existing flow reachable without interaction.
