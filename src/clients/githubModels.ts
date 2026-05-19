import { request } from "undici";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ChatClient, ChatMessage } from "./ChatClient.js";
import { ModelRefusalError, assertNotRefusal } from "./vscodeLm.js";

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

  async sendStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodSchema<T>,
    schemaName: string,
  ): Promise<T> {
    const jsonSchema = zodToJsonSchema(schema, { name: schemaName });
    const response_format = {
      type: "json_schema" as const,
      json_schema: {
        name: schemaName,
        // zod-to-json-schema places the actual schema under definitions[name]
        schema:
          (jsonSchema as { definitions?: Record<string, unknown> }).definitions?.[schemaName] ??
          jsonSchema,
        strict: true,
      },
    };

    const attempt = async (msgs: ChatMessage[]): Promise<string> => {
      const res = await request(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: msgs,
          response_format,
        }),
      });
      if (res.statusCode >= 400) {
        const text = await res.body.text();
        throw new Error(`GitHub Models request failed (${res.statusCode}): ${text}`);
      }
      const body = (await res.body.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("GitHub Models response did not contain message content.");
      }
      return content;
    };

    const tryParse = (raw: string): T => {
      assertNotRefusal(raw, this.modelId);
      const parsed = JSON.parse(raw) as unknown;
      return schema.parse(parsed);
    };

    let firstError: unknown;
    try {
      const content = await attempt(messages);
      return tryParse(content);
    } catch (err) {
      if (err instanceof ModelRefusalError) throw err;
      firstError = err;
    }

    const retryMessages: ChatMessage[] = [
      ...messages,
      {
        role: "system",
        content:
          `Your previous response was not valid JSON for schema "${schemaName}". ` +
          `Reply with ONLY a JSON object matching this schema and nothing else: ${JSON.stringify(
            response_format.json_schema.schema,
          )}`,
      },
    ];
    try {
      const content = await attempt(retryMessages);
      return tryParse(content);
    } catch (err) {
      if (err instanceof ModelRefusalError) throw err;
      throw new Error(
        `Reviewer response failed schema "${schemaName}" twice. ` +
          `First error: ${(firstError as Error)?.message}. Retry error: ${(err as Error)?.message}`,
      );
    }
  }

  async sendText(messages: ChatMessage[]): Promise<string> {
    const res = await request(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: this.modelId, messages }),
    });
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new Error(`GitHub Models request failed (${res.statusCode}): ${text}`);
    }
    const body = (await res.body.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("GitHub Models response did not contain message content.");
    return content;
  }
}
