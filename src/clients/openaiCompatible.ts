import { z } from "zod";
import {
  ReviewCancelledError,
  throwIfAborted,
  type ChatClient,
  type ChatMessage,
  type SendOptions,
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
    const parsed = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`Response from ${this.endpoint} did not contain message content.`);
    }
    return content;
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

    const attempt = (msgs: ChatMessage[]) =>
      this.post({ model: this.modelId, messages: msgs, response_format }, opts?.signal);

    const tryParse = (raw: string): T => {
      assertNotRefusal(raw, this.modelId);
      return schema.parse(JSON.parse(raw) as unknown);
    };

    let firstRaw = "";
    let firstError: unknown;
    try {
      firstRaw = await attempt(messages);
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
      return tryParse(await attempt(retryMessages));
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
    return this.post({ model: this.modelId, messages }, opts?.signal);
  }
}
