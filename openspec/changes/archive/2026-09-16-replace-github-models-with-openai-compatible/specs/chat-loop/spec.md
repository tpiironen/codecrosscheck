# chat-loop delta: replace-github-models-with-openai-compatible

## MODIFIED Requirements

### Requirement: Provider-agnostic ChatClient

Worker and reviewer SHALL be invoked through the `ChatClient` interface. The implementation SHALL provide at least two adapters: one for any OpenAI-compatible `/chat/completions` endpoint and one for the VS Code Language Model API (`vscode.lm`). Adding a new provider SHALL require only a new adapter, not changes to the loop.

The OpenAI-compatible adapter SHALL take its base URL from configuration and
SHALL NOT default to any provider. A missing base URL SHALL fail with an error
naming the configuration that supplies it. Defaulting to a provider is how the
adapter came to be hard-wired to a service that was subsequently retired.

The adapter SHALL treat the API key as optional. When no key is configured it
SHALL omit the `Authorization` header rather than sending an empty or
placeholder credential, so that endpoints requiring no authentication work
unmodified.

The adapter SHALL NOT source credentials from a provider-specific helper such
as `gh auth token`. A credential resolved for one provider must not be sent to
an arbitrary configured base URL.

#### Scenario: Adapter sends a configured key

- **GIVEN** a base URL and an API key are configured
- **WHEN** the OpenAI-compatible adapter sends a request
- **THEN** the request includes `Authorization: Bearer <key>`
- **AND** the request targets `<base URL>/chat/completions`

#### Scenario: Adapter omits auth when no key is configured

- **GIVEN** a base URL is configured and no API key is
- **WHEN** the adapter sends a request
- **THEN** the request carries no `Authorization` header

#### Scenario: Missing base URL is a named error

- **GIVEN** no base URL is configured
- **WHEN** the adapter is constructed
- **THEN** it throws an error naming the configuration that supplies the base
  URL

#### Scenario: vscode.lm adapter selects the requested model

- **WHEN** the `vscode.lm` adapter is built with family `gpt-5`
- **THEN** it calls `vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-5" })`
