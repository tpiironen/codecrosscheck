# Security Policy

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Report privately via GitHub's
[security advisory form](https://github.com/tpiironen/codecrosscheck/security/advisories/new),
or by email to the address listed on the maintainer's GitHub profile.

Include:

- A description of the issue and its impact.
- Steps to reproduce (a minimal proof-of-concept is ideal).
- Affected version(s) and platform(s).
- Whether you intend to disclose publicly and on what timeline.

You can expect an initial acknowledgement within **5 working days** and
a triage update within **10 working days**.

## Scope

CodeCrossCheck executes LLM-produced code in a sandboxed child process
(`src/sandbox.ts`). Specifically in scope:

- Sandbox escape (network, filesystem outside tmpdir, env-var leak).
- Command/shell injection in the OpenSpec validator pre-gate
  (`src/openspec/validate.ts`).
- Path-traversal in `/apply-review` file writes (`src/applyReview.ts`).
- Prompt-injection vectors that cause secret exfiltration via the
  reviewer model.
- Unsafe deserialisation of model output (Zod validation bypass).

Out of scope:

- LLM hallucinations or low-quality reviews — that's a model limitation,
  not a vulnerability.
- Misuse of the tool in environments without the recommended sandbox
  defaults.
- Dependencies for which an upstream advisory already exists; please
  report to upstream first.

## Supported versions

Only the latest minor release is supported with security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |
