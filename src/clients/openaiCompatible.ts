import { z } from "zod";
import {
  ReviewCancelledError,
  TOOL_BUDGET_REFUSAL,
  budgetExceeded,
  openToolBudget,
  throwIfAborted,
  toolBudgetNudge,
  toolsEnabled,
  type ChatClient,
  type ChatMessage,
  type ChatRole,
  type SendOptions,
  type ToolCall,
} from "./ChatClient.js";
import { ModelRefusalError, assertNotRefusal, assertNotOversized } from "./vscodeLm.js";
import { explainFailure, satisfiesStrictMode, toProviderJsonSchema } from "./schemaText.js";

export const BASE_URL_ENV = "CODECROSSCHECK_BASE_URL";
export const API_KEY_ENVS = ["CODECROSSCHECK_API_KEY", "OPENAI_API_KEY"] as const;

export interface OpenAiCompatibleOptions {
  modelId: string;
  /** API root, e.g. "https://api.openai.com/v1". `/chat/completions` is appended. */
  baseUrl?: string;
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * There is deliberately no default provider. The previous client hard-coded
 * one, and when that service was retired every CLI invocation broke.
 */
export function resolveBaseUrl(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return explicit?.trim() || env[BASE_URL_ENV]?.trim() || null;
}

/** Optional by design: endpoints such as a local Ollama server take no key. */
export function resolveApiKey(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (explicit?.trim()) return explicit.trim();
  for (const name of API_KEY_ENVS) {
    const v = env[name]?.trim();
    if (v) return v;
  }
  return null;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

/** Adapter for any endpoint speaking the OpenAI `/chat/completions` protocol. */
export class OpenAiCompatibleClient implements ChatClient {
  readonly modelId: string;
  readonly endpoint: string;
  private readonly apiKey: string | null;

  constructor(opts: OpenAiCompatibleOptions) {
    const env = opts.env ?? process.env;
    const baseUrl = resolveBaseUrl(opts.baseUrl, env);
    if (!baseUrl) {
      throw new Error(
        `No model endpoint configured. Set ${BASE_URL_ENV} (or pass --base-url) to an ` +
          `OpenAI-compatible API root, e.g. "https://api.openai.com/v1", an Azure AI Foundry ` +
          `deployment URL, or "http://localhost:11434/v1" for a local server. ` +
          `Authentication is optional: set ${API_KEY_ENVS.join(" or ")} if your endpoint needs one.`,
      );
    }
    this.modelId = opts.modelId;
    this.endpoint = chatCompletionsUrl(baseUrl);
    this.apiKey = resolveApiKey(opts.apiKey, env);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    // Omit rather than send an empty credential, so keyless endpoints work.
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private async post(body: unknown, signal: AbortSignal | undefined): Promise<string> {
    const message = await this.postRaw(body, signal);
    if (!message.content) {
      throw new Error(`Response from ${this.endpoint} did not contain message content.`);
    }
    return message.content;
  }

  /**
   * One request/response turn. Returns the assistant message verbatim, because
   * a turn that only requests tools legitimately carries no content.
   */
  private async postRaw(body: unknown, signal: AbortSignal | undefined): Promise<ChatCompletionMessage> {
    throwIfAborted(signal, this.modelId);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw new ReviewCancelledError(this.modelId);
      throw err;
    }
    if (!res.ok) {
      throw new Error(`Model request to ${this.endpoint} failed (${res.status}): ${await res.text()}`);
    }
    const parsed = (await res.json()) as { choices?: { message?: ChatCompletionMessage }[] };
    const message = parsed.choices?.[0]?.message;
    if (!message) {
      throw new Error(`Response from ${this.endpoint} did not contain a message.`);
    }
    return message;
  }

  /**
   * Issue one send, running a tool round trip first when tools are offered.
   * `extra` carries per-call request fields such as `response_format`.
   */
  private async send(
    messages: ChatMessage[],
    extra: Record<string, unknown>,
    opts: SendOptions | undefined,
  ): Promise<string> {
    const tools = opts?.tools;
    const history: WireMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
    if (!toolsEnabled(tools)) {
      return this.post({ model: this.modelId, messages: history, ...extra }, opts?.signal);
    }

    const budget = openToolBudget(tools);
    const declared = tools.specs.map((s) => ({
      type: "function" as const,
      function: { name: s.name, description: s.description, parameters: s.inputSchema },
    }));

    for (;;) {
      const stop = budgetExceeded(budget);
      if (stop) {
        history.push({ role: "user", content: toolBudgetNudge(stop, budget) });
        const cut = await this.post(
          { model: this.modelId, messages: history, ...extra },
          opts?.signal,
        );
        tools.onFinish?.({ stop, callCount: budget.calls });
        return cut;
      }

      const message = await this.postRaw(
        { model: this.modelId, messages: history, tools: declared, tool_choice: "auto", ...extra },
        opts?.signal,
      );
      const requested = message.tool_calls ?? [];
      if (requested.length === 0) {
        if (!message.content) {
          throw new Error(`Response from ${this.endpoint} did not contain message content.`);
        }
        tools.onFinish?.({ stop: "final", callCount: budget.calls });
        return message.content;
      }

      // Every requested call must be answered or the next request is
      // malformed, so each one gets a `role: "tool"` reply — but the budget is
      // a hard cap on work actually done: once it is spent the remaining calls
      // in this turn are refused rather than invoked.
      history.push(message);
      for (const raw of requested) {
        throwIfAborted(opts?.signal, this.modelId);
        const call: ToolCall = {
          callId: raw.id,
          name: raw.function.name,
          input: decodeArguments(raw.function.arguments),
        };
        if (budget.calls >= budget.maxCalls) {
          history.push({ role: "tool", tool_call_id: raw.id, content: TOOL_BUDGET_REFUSAL });
          continue;
        }
        budget.calls++;
        tools.onCallStart?.(call);
        const result = await tools.invoke(call, { deadlineAt: budget.deadlineAt });
        tools.onCall?.(call, result);
        history.push({ role: "tool", tool_call_id: raw.id, content: result.content });
      }
    }
  }

  async sendStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    schemaName: string,
    opts?: SendOptions,
  ): Promise<T> {
    const jsonSchema = toProviderJsonSchema(schema as z.ZodType<unknown>, schemaName);
    const response_format = {
      type: "json_schema" as const,
      json_schema: {
        name: schemaName,
        schema: jsonSchema,
        // Only claim strict mode when the generated schema actually satisfies
        // it, or the provider rejects the request outright.
        strict: satisfiesStrictMode(jsonSchema),
      },
    };

    const attempt = (msgs: ChatMessage[], useTools: boolean) =>
      this.send(msgs, { response_format }, useTools ? opts : { ...opts, tools: undefined });

    const tryParse = (raw: string): T => {
      assertNotRefusal(raw, this.modelId);
      return schema.parse(JSON.parse(raw) as unknown);
    };

    let firstRaw = "";
    let firstError: unknown;
    try {
      firstRaw = await attempt(messages, true);
      return tryParse(firstRaw);
    } catch (err) {
      if (err instanceof ReviewCancelledError) throw err;
      if (err instanceof ModelRefusalError) throw err;
      assertNotOversized(err, this.modelId);
      firstError = err;
    }

    throwIfAborted(opts?.signal, this.modelId);

    // Echo the failed response back so the model can see what it produced.
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: firstRaw },
      {
        role: "system",
        content:
          `That response is not valid JSON for schema "${schemaName}". ` +
          `It failed with: ${explainFailure(firstError)}. ` +
          `Reply with ONLY a JSON object matching this schema and nothing else: ${JSON.stringify(jsonSchema)}`,
      },
    ];
    try {
      // No tools on the retry: the reminder is about JSON shape, not missing
      // data, and re-running the loop would spend a second budget on it.
      return tryParse(await attempt(retryMessages, false));
    } catch (err) {
      if (err instanceof ReviewCancelledError) throw err;
      if (err instanceof ModelRefusalError) throw err;
      assertNotOversized(err, this.modelId);
      throw new Error(
        `Reviewer response failed schema "${schemaName}" twice. ` +
          `First error: ${explainFailure(firstError)}. Retry error: ${explainFailure(err)}.`,
      );
    }
  }

  async sendText(messages: ChatMessage[], opts?: SendOptions): Promise<string> {
    return this.send(messages, {}, opts);
  }
}

/** The subset of an OpenAI `chat.completion` assistant message this client reads. */
interface ChatCompletionMessage {
  role: "assistant";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
}

type WireMessage =
  | { role: ChatRole; content: string }
  | { role: "tool"; tool_call_id: string; content: string }
  | ChatCompletionMessage;

/**
 * Providers send tool arguments as a JSON *string*. Malformed JSON is handed to
 * the tool as-is rather than thrown, so the toolset can answer with an input
 * error the model can correct on its next call.
 */
function decodeArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
