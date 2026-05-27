# chat-loop spec delta

## MODIFIED Requirements

### Requirement: Structured-response clients SHALL short-circuit on oversized-prompt failures

Structured-response clients SHALL detect token-limit / context-window-exceeded
errors from the underlying transport and SHALL throw a typed
`OversizedPromptError` carrying the model id and the original cause, *before*
attempting the schema-reminder retry. This applies to both
`VscodeLmClient.sendStructured` and `GithubModelsClient.sendStructured`.

Re-sending the identical oversized prompt with a schema-reminder system
message cannot succeed — it produces a second confusing failure (an empty
body, a `{"verdict":"unknown"}` payload, or a model complaint that no schema
is in scope) that masks the real cause. Short-circuiting preserves a single,
actionable error message.

The detector SHALL recognise at minimum the following phrasings (case
insensitive):

- "Message exceeds token limit"
- "maximum context length"
- "context window exceeded" / "context length exceeded"
- "prompt is too long" / "input is too long"
- "request too large"

The detector SHALL NOT classify generic transport failures
(`ECONNRESET`, `Unexpected token …`) as oversized.

#### Scenario: First-attempt token-limit failure skips the retry

- **WHEN** `VscodeLmClient.sendStructured` calls the LM and the call rejects
  with an error whose message matches an oversized-prompt phrasing
- **THEN** the client throws `OversizedPromptError` and SHALL NOT call the
  LM a second time with the schema-reminder retry

#### Scenario: Retry-attempt token-limit failure surfaces as OversizedPromptError

- **WHEN** the first attempt fails with a schema/parse error and the retry
  attempt fails with a token-limit error
- **THEN** the client throws `OversizedPromptError` instead of the
  two-strike "failed schema twice" fallback message

#### Scenario: Unrelated failures are not misclassified

- **WHEN** the LM rejects with `ECONNRESET` or returns prose that fails
  `JSON.parse`
- **THEN** `OversizedPromptError` is NOT thrown and the normal
  retry/two-strike paths run

#### Scenario: OversizedPromptError carries actionable remediation

- **WHEN** `OversizedPromptError` is thrown
- **THEN** its `.message` includes the model id and suggests at least one
  concrete remedy (`diff-base=<closer-ref>`, split the branch, or pick a
  larger reviewer model)
