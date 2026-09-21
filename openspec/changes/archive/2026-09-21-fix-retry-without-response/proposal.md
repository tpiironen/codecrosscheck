# Change: fix-retry-without-response

## Why

`sendStructured` in both clients initialises `firstRaw = ""` and only assigns
it on success:

```ts
let firstRaw = "";
try {
  firstRaw = await this.sendRaw(messages, opts);
  return tryParseOrRefuse(firstRaw);
} catch (err) {
  ...
  firstError = err;
}
```

When the first attempt throws *before producing any text* — an HTTP 500 or 429
from an OpenAI-compatible endpoint, `Response from <endpoint> did not contain
message content.`, or `sendRequest` rejecting in the extension host — `firstRaw`
is still `""`. The retry is then built unconditionally:

```ts
{ role: "assistant", content: firstRaw },
{ role: "system", content: `That response is not valid JSON for schema "${schemaName}". It failed with: ...` }
```

Two defects follow, and the second is the one that matters:

1. **A turn the model never produced is fabricated.** An empty assistant
   message is appended to the history. In `VscodeLmClient` this becomes
   `vscode.LanguageModelChatMessage.Assistant("")`.
2. **The model is told something untrue.** There was no response, yet the
   reminder asserts "that response is not valid JSON" and renders a transport
   error through `explainFailure` as though it were a schema violation. The
   retry then asks the model to correct output it never emitted.

This is the same shape as the defect recorded in the 0.5.1 dogfood session: a
justification that rests on a fact nobody tested. Here the prompt itself
carries the false premise, on every transport failure.

The existing requirement says the retry SHALL include "the model's own failed
response". When the attempt produced no response, that clause has no referent
and the implementation silently substitutes an empty string.

## What Changes

- When the first structured attempt produces **no response text**, the retry
  SHALL re-send the original messages unchanged, with no fabricated assistant
  turn and no "not valid JSON" reminder. A failure that produced nothing is a
  transient send failure, and re-sending is the only meaningful retry.
- When the first attempt **did** produce text, behaviour is unchanged: the
  response is echoed as an assistant turn with the error and the generated
  schema description, exactly as today.
- The two-strike error message is unchanged and still reports both errors, so
  the originating transport failure remains visible.

## Impact

- Affected specs: `chat-loop` (modifies "The structured-output retry SHALL show
  the model its failure"; all three existing scenarios are retained verbatim
  and one is added).
- Affected code: `src/clients/vscodeLm.ts` and `src/clients/openaiCompatible.ts`
  — the retry-message construction in `sendStructured` only.
- No configuration change. No change to the tool loop, cancellation, refusal
  detection, or oversized-prompt handling.
- Risk: low. The changed path is reached only when the first attempt threw
  without returning text, which today always produces a wasted call carrying a
  false premise.
