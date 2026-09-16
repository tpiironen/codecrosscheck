# chat-loop spec delta

## MODIFIED Requirements

### Requirement: Sandboxed execution

Code executed in the `EXECUTE` stage SHALL run in a temporary working directory
under `os.tmpdir()`, with a hard timeout, and with the environment scrubbed to
an allowlist. It SHALL NOT claim any isolation property it does not enforce.

Specifically, the sandbox SHALL NOT set `NO_PROXY` as a network-denial
mechanism. `NO_PROXY` instructs clients to bypass a proxy and does not deny
network access, so presenting it as an `allowNetwork: false` implementation
misrepresents the boundary. The `allowNetwork` option SHALL be removed rather
than retained with no effect, and network access SHALL be documented as
unrestricted.

Documentation and setting descriptions SHALL state plainly that generated code
runs with the invoking user's filesystem privileges.

#### Scenario: Timeout enforced

- **GIVEN** `timeoutMs: 1000`
- **WHEN** the executed code runs an infinite loop
- **THEN** the process is killed within 2000 ms
- **AND** `runSandboxed` returns with a non-zero `exitCode`

#### Scenario: Tempdir isolation

- **WHEN** the executed code writes to its current working directory
- **THEN** the writes occur under `os.tmpdir()`
- **AND** the tempdir is removed after `runSandboxed` returns

#### Scenario: Environment scrubbed

- **GIVEN** the calling process has `SECRET_KEY=hunter2` in its environment
- **WHEN** the executed code prints its environment
- **THEN** the output does not contain `SECRET_KEY` or `hunter2`

#### Scenario: Sandbox does not set proxy-bypass variables

- **WHEN** code is executed through the sandbox
- **THEN** the child environment contains no `NO_PROXY` or `no_proxy` entry
  introduced by the sandbox

## ADDED Requirements

### Requirement: Subprocess invocation SHALL NOT shell-interpret a command string

Per the repository's implementation conventions, subprocess invocations SHALL
use `spawn` with an explicit argument vector, `cwd`, and a hard timeout.

The post-apply build gate accepts a user-authored command line, which
necessarily requires a shell to interpret. Where a shell is unavoidable the
implementation SHALL document why at the call site, SHALL source the command
only from a non-workspace-overridable setting, and SHALL enforce the same
timeout and output cap as any other subprocess.

#### Scenario: Build gate enforces a timeout and output cap

- **WHEN** a configured build command runs longer than the configured timeout
- **THEN** the child is terminated, the result reports `timedOut: true`, and
  the captured output is truncated to the configured cap

#### Scenario: Shell usage is justified at the call site

- **WHEN** the build gate implementation is inspected
- **THEN** it carries a comment explaining why a shell is required and
  recording that the command source is not workspace-overridable
