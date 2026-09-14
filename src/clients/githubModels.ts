import { spawnSync } from "node:child_process";
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

const DEFAULT_ENDPOINT = "https://models.github.ai/inference/chat/completions";

export interface GithubModelsOptions {
  modelId: string;
  token?: string;
  endpoint?: string;
}

/** Resolve a GitHub token from explicit option → GITHUB_TOKEN → `gh auth token`. */
export function resolveGithubToken(explicit?: string): string | null {
  if (explicit) return explicit;
  const env = process.env.GITHUB_TOKEN;
  if (env) return env;
  try {
    const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
    if (r.status === 0) {
      const t = r.stdout.trim();
      if (t) return t;
    }
  } catch {
    // gh not installed or not authenticated; fall through
  }
  return null;
}

export class GithubModelsClient implements ChatClient {
  readonly modelId: string;
  private readonly token: string;
  private readonly endpoint: string;

  constructor(opts: GithubModelsOptions) {
    this.modelId = opts.modelId;
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    const token = resolveGithubToken(opts.token);
    if (!token) {
      throw new Error(
        "No GitHub token available. Set GITHUB_TOKEN or run `gh auth login` first. The token needs the 'models:read' scope.",
      );
    }
    this.token = token;
  }

  private async post(body: unknown, signal: AbortSignal | undefined): Promise<string> {
    throwIfAborted(signal, this.modelId);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw new ReviewCancelledError(this.modelId);
      throw err;
    }
    if (!res.ok) {
      throw new Error(`GitHub Models request failed (${res.status}): ${await res.text()}`);
    }
    const parsed = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("GitHub Models response did not contain message content.");
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
