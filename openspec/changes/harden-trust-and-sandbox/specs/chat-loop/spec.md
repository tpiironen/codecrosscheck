# chat-loop spec delta

## MODIFIED Requirements

### Requirement: The sandbox SHALL NOT claim unimplemented isolation

The EXECUTE sandbox SHALL isolate the working directory, scrub the
environment to an allowlist, and enforce a hard timeout. It SHALL NOT claim
any isolation property it does not enforce.

Specifically, the sandbox SHALL NOT set `NO_PROXY` as a network-denial
mechanism. `NO_PROXY` instructs clients to bypass a proxy and does not deny
network access, so presenting it as an `allowNetwork: false` implementation
misrepresents the boundary. The `allowNetwork` option SHALL be removed rather
than retained with no effect.

Documentation and setting descriptions SHALL state plainly that generated code
runs with the invoking user's filesystem privileges.

#### Scenario: Sandbox does not set proxy-bypass variables

- **WHEN** code is executed through the sandbox
- **THEN** the child environment contains no `NO_PROXY` or `no_proxy` entry
  introduced by the sandbox

#### Scenario: Environment remains allowlisted

- **WHEN** code is executed through the sandbox
- **THEN** the child environment contains only variables on the allowlist, and
  no other variable from the parent process

#### Scenario: Timeout is still enforced

- **WHEN** executed code exceeds the configured timeout
- **THEN** the child is killed and the result reports `timedOut: true`

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
