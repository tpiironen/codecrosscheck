# chat-loop spec delta

## ADDED Requirements

### Requirement: Model calls SHALL be cancellable

`ChatClient.sendText` and `ChatClient.sendStructured` SHALL accept an optional
`AbortSignal` and SHALL pass it to the underlying transport so an in-flight
request is abandoned when the signal aborts.

Implementations SHALL NOT create a cancellation source that no caller can
trigger. Any cancellation source an implementation creates for transport
purposes SHALL be disposed when the call settles.

When a call is aborted the client SHALL throw a typed `ReviewCancelledError`
rather than a transport-specific error, and SHALL NOT attempt the
schema-reminder retry.

#### Scenario: Aborting a signal abandons the in-flight request

- **WHEN** a client call is in flight and its `AbortSignal` aborts
- **THEN** the call rejects with `ReviewCancelledError`

#### Scenario: Abort short-circuits the schema retry

- **WHEN** the first structured attempt fails to parse and the signal aborts
  before the retry is issued
- **THEN** no retry request is sent and the call rejects with
  `ReviewCancelledError`

#### Scenario: Transport cancellation sources are disposed

- **WHEN** a `VscodeLmClient` call settles, whether by success or failure
- **THEN** any `CancellationTokenSource` the client created for that call is
  disposed

### Requirement: The loop SHALL stop between iterations when cancelled

`reviewLoop` SHALL accept an optional `AbortSignal` and SHALL check it before
starting each iteration and before calling the reviewer. On abort it SHALL
return the artifacts and history produced so far with `approved: false` and a
`cancelled: true` marker, rather than throwing.

`runPipeline` SHALL check the same signal between stages and SHALL not begin a
stage after abort.

#### Scenario: Abort before an iteration ends the loop cleanly

- **WHEN** the signal aborts after iteration 1 completes and before iteration 2
  begins
- **THEN** `reviewLoop` returns with `iterations: 1`, `approved: false`,
  `cancelled: true`, and the iteration-1 history intact

#### Scenario: Abort between stages stops the pipeline

- **WHEN** the signal aborts after the PLAN stage completes
- **THEN** the CODE stage is not started and the pipeline result contains only
  the PLAN stage

#### Scenario: An un-aborted run is unaffected

- **WHEN** no signal is supplied, or the supplied signal never aborts
- **THEN** loop and pipeline behaviour is identical to the previous
  implementation
