# Change: correct-vscode-extension-spec-drift

## Why

Three requirements in `openspec/specs/vscode-extension/spec.md` describe an
implementation that no longer exists. Each was left behind when a later change
was archived, and `openspec validate --strict` cannot detect prose that has
drifted from code.

**1. A setting that was removed is still required.** The "VS Code settings"
requirement lists `codecrosscheck.execute.allowNetwork`. That setting was
removed by `harden-trust-and-sandbox` (0.5.0) because it never did anything —
`openspec/project.md` now states outright "There is no network toggle, because
none was ever implemented." The spec still obliges the extension to contribute
it. The same list is also silently incomplete: `package.json` contributes 15
settings under `codecrosscheck.*`, and the requirement names 5.

**2. Re-review scoping cites a mechanism that was deleted.** The requirement
says the scoped paths "SHALL be the same set already harvested for the fixer's
repository file context, derived from each finding's `where` and `suggestion`
fields and from the fix proposal." `replace-context-harvest-with-tools` removed
that harvest — `harvestPathsFromText` no longer exists anywhere in `src/`. The
implementation at `src/extension.ts` now scopes to
`editsFrom(lastProposal).map((e) => e.path)`: the fix proposal's own edit paths,
and nothing from the findings. The spec describes a wider input set than the
code builds.

**3. Triage is said to receive a file context it is not given.** The triage
requirement says "The triage step SHALL receive the repository file context
already harvested for the cited paths". `buildTriageInput` takes only
`{ verdict, diffDescription, scopeBlock }`. Triage instead receives the
workspace toolset (`tools: toolsFor("triager")`) and reads files itself. The
stated goal — "judges against current source rather than from the finding's
wording alone" — is still met, but by a different mechanism.

Item 3 matters beyond tidiness: a reviewer reading this spec would conclude
triage is fed a pre-built context and could flag the tool grant as
unspecified behaviour.

## What Changes

- The settings requirement drops `codecrosscheck.execute.allowNetwork` and
  states that the named settings are a minimum rather than the complete set,
  so adding a setting is not a spec violation.
- The re-review scoping requirement states the actual derivation: the paths
  touched by the fix proposal's edits.
- The triage requirement states that triage is granted the workspace toolset to
  read current source, replacing the reference to a harvested context.
- No behaviour changes. This change edits specification prose only, to make it
  describe the shipped 0.5.1 implementation.

## Impact

- Affected specs: `vscode-extension` (three modified requirements; every
  existing scenario is retained verbatim).
- Affected code: none.
- Risk: none to runtime. The risk being removed is a reviewer or contributor
  acting on a requirement that contradicts the code.
