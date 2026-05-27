import { z } from "zod";
import type { ChatClient, ChatMessage } from "./ChatClient.js";

// `vscode` is a peer dependency; we import it lazily so the CLI build works without it.
type VsCodeLm = typeof import("vscode") extends { lm: infer L } ? L : never;

// Minimal structural type for a vscode.LanguageModelChat — kept loose so we
// don't depend on @types/vscode at the CLI build boundary, and so it accepts
// the real LanguageModelChat instance passed in from a chat participant.
interface LmChat {
  readonly vendor: string;
  readonly family: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendRequest(messages: any, options: any, token: any): any;
}

export interface VscodeLmOptions {
  vendor?: string;
  family: string;
  /** Pre-resolved chat model (e.g. `request.model` from a chat participant). When set, vendor/family are derived from it. */
  model?: LmChat;
  /** Injected for testing; defaults to runtime require of "vscode". */
  lm?: VsCodeLm;
}

export class VscodeLmClient implements ChatClient {
  readonly modelId: string;
  private readonly vendor: string;
  private readonly family: string;
  private readonly preselected?: LmChat;
  private readonly lmPromise: Promise<VsCodeLm>;

  constructor(opts: VscodeLmOptions) {
    if (opts.model) {
      this.preselected = opts.model;
      this.vendor = opts.model.vendor;
      this.family = opts.model.family;
    } else {
      this.preselected = undefined;
      this.vendor = opts.vendor ?? "copilot";
      this.family = opts.family;
    }
    this.modelId = `${this.vendor}/${this.family}`;
    this.lmPromise = opts.lm
      ? Promise.resolve(opts.lm)
      : import("vscode").then((m) => m.lm as VsCodeLm);
  }

  private async select(): Promise<LmChat> {
    if (this.preselected) return this.preselected;
    const lm = await this.lmPromise;
    const models = await lm.selectChatModels({ vendor: this.vendor, family: this.family });
    if (models.length === 0) {
      throw new Error(
        `No vscode.lm models match vendor="${this.vendor}" family="${this.family}". ` +
          `Update codecrosscheck.workerModel / codecrosscheck.reviewerModel to a family available in this VS Code session.`,
      );
    }
    return models[0]!;
  }

  private async sendRaw(messages: ChatMessage[]): Promise<string> {
    const vscode = await import("vscode");
    const model = await this.select();
    const lmMessages = messages.map((m) =>
      m.role === "assistant"
        ? vscode.LanguageModelChatMessage.Assistant(m.content)
        : vscode.LanguageModelChatMessage.User(m.content),
    );
    const response = await model.sendRequest(lmMessages, {}, new vscode.CancellationTokenSource().token);
    let buf = "";
    for await (const chunk of response.text) {
      buf += chunk;
    }
    return buf;
  }

  async sendText(messages: ChatMessage[]): Promise<string> {
    return this.sendRaw(messages);
  }

  async sendStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodSchema<T>,
    schemaName: string,
  ): Promise<T> {
    const send = (msgs: ChatMessage[]) => this.sendRaw(msgs);

    const tryParseOrRefuse = (raw: string): T => {
      // Refusals never become valid JSON — surface them up immediately so the user sees the cause
      // instead of a confusing "Unexpected token 'S'" parse error after a wasted retry.
      assertNotRefusal(raw, this.modelId);
      return schema.parse(JSON.parse(extractJson(raw)));
    };

    let firstRaw = "";
    let firstError: unknown;
    try {
      firstRaw = await send(messages);
      return tryParseOrRefuse(firstRaw);
    } catch (err) {
      if (err instanceof ModelRefusalError) throw err;
      // Token-limit failures cannot be fixed by re-asking with the same prompt + a schema reminder.
      // Re-throw as a typed error so callers (and users) see the actual problem instead of a
      // wasted retry that fails the same way.
      assertNotOversized(err, this.modelId);
      firstError = err;
    }

    const retryMessages: ChatMessage[] = [
      ...messages,
      {
        role: "system",
        content:
          `Your previous response was not valid JSON for schema "${schemaName}". ` +
          `Reply with ONLY a JSON object validating against this zod schema description: ` +
          schemaDescription(schema),
      },
    ];
    let retryRaw = "";
    try {
      retryRaw = await send(retryMessages);
      return tryParseOrRefuse(retryRaw);
    } catch (err) {
      if (err instanceof ModelRefusalError) throw err;
      assertNotOversized(err, this.modelId);
      throw new Error(
        `vscode.lm response failed schema "${schemaName}" twice. ` +
          `First: ${(firstError as Error)?.message} (raw: ${snippet(firstRaw)}). ` +
          `Retry: ${(err as Error)?.message} (raw: ${snippet(retryRaw)}).`,
      );
    }
  }
}

/** Thrown when a model returns a content-policy refusal instead of an answer. Retry won't help. */
export class ModelRefusalError extends Error {
  constructor(public readonly modelId: string, public readonly raw: string) {
    super(
      `Model "${modelId}" refused the request (no structured output produced). ` +
        `Response: ${snippet(raw)}. ` +
        `Try a different worker/reviewer model, shorten or rephrase the prompt, ` +
        `or remove content that may have triggered the content filter.`,
    );
    this.name = "ModelRefusalError";
  }
}

const REFUSAL_PATTERNS: readonly RegExp[] = [
  /^\s*(?:```[a-z]*\s*)?sorry,?\s+(?:i|but i)\b[^.\n]*?(?:can(?:not|'t)|won'?t|unable)\b/i,
  /^\s*(?:```[a-z]*\s*)?i(?:'m| am)?\s+(?:sorry|afraid)[^.\n]*?(?:can(?:not|'t)|unable|won'?t)\b/i,
  /^\s*(?:```[a-z]*\s*)?i(?:'m| am)?\s+(?:can(?:not|'t)|won'?t|unable(?:\s+to)?)\s+(?:assist|help|comply|do that|provide|continue|fulfill|respond)\b/i,
];

function assertNotRefusal(raw: string, modelId: string): void {
  const head = raw.slice(0, 400);
  if (REFUSAL_PATTERNS.some((re) => re.test(head))) {
    throw new ModelRefusalError(modelId, raw);
  }
}

export { assertNotRefusal };

/**
 * Thrown when the LM rejects the prompt as too large for its context window. Retrying with the
 * same prompt + a schema reminder cannot succeed — surface the failure so the caller can shrink
 * the input (or guard on token count before sending).
 */
export class OversizedPromptError extends Error {
  constructor(public readonly modelId: string, public readonly cause: Error) {
    super(
      `Model "${modelId}" rejected the prompt as too large for its context window: ${cause.message}. ` +
        `Shrink the input (e.g. pass diff-base=<closer-ref> to /review-branch, split the branch, ` +
        `or remove large attachments) and try again. Retrying with the same prompt cannot succeed.`,
    );
    this.name = "OversizedPromptError";
  }
}

// Phrases LM providers use when the prompt exceeds the model's context window. Kept conservative
// — we only short-circuit retry on a high-confidence match.
const OVERSIZED_PATTERNS: readonly RegExp[] = [
  /message exceeds (?:the )?token limit/i,
  /context (?:window|length) (?:exceeded|exhausted|too (?:large|long))/i,
  /prompt is too (?:long|large)/i,
  /input (?:is )?too (?:long|large)/i,
  /maximum context length/i,
  /request too large/i,
  /\b(?:tokens?|context).{0,40}\bexceed(?:s|ed)?\b/i,
];

export function assertNotOversized(err: unknown, modelId: string): void {
  if (err instanceof OversizedPromptError) throw err;
  const msg = (err as { message?: string })?.message ?? "";
  if (OVERSIZED_PATTERNS.some((re) => re.test(msg))) {
    throw new OversizedPromptError(modelId, err as Error);
  }
}

function snippet(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

function extractJson(raw: string): string {
  // The model may wrap JSON in fences or prose. Extract the largest JSON object substring.
  // Only strip fences explicitly labelled `json` or unlabelled — never trust an unknown tag
  // like ```text, which could hide a refusal inside what looks like a JSON fence to a naive regex.
  const fence = raw.match(/```(?:json)?\r?\n([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw.trim();
}

function schemaDescription(schema: z.ZodSchema<unknown>): string {
  // Best-effort textual hint; the JSON-schema generator is used in the GitHub Models path.
  return schema.description ?? "the previously stated structured-verdict schema";
}
