import { z } from "zod";
import {
  ReviewCancelledError,
  throwIfAborted,
  type ChatClient,
  type ChatMessage,
  type SendOptions,
} from "./ChatClient.js";
import { describeSchema, explainFailure } from "./schemaText.js";

// `vscode` is a peer dependency; we import it lazily so the CLI build works without it.
type VsCodeLm = typeof import("vscode") extends { lm: infer L } ? L : never;

// Minimal structural type for a vscode.LanguageModelChat — kept loose so we
// don't depend on @types/vscode at the CLI build boundary, and so it accepts
// the real LanguageModelChat instance passed in from a chat participant.
interface LmChat {
  readonly vendor: string;
  readonly family: string;
  sendRequest(
    messages: never[],
    options: Record<string, never>,
    token: never,
  ): PromiseLike<{ text: AsyncIterable<string> }>;
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
      const available = await Promise.resolve(lm.selectChatModels({ vendor: this.vendor })).catch(
        () => [] as Array<{ family: string }>,
      );
      const families = Array.from(new Set(available.map((m) => m.family))).sort();
      throw new Error(
        `No vscode.lm model matches vendor="${this.vendor}" family="${this.family}". ` +
          (families.length
            ? `Available families: ${families.join(", ")}. `
            : "No models are available in this session. ") +
          `Run "CodeCrossCheck: Pick Worker and Reviewer Models", or set ` +
          `codecrosscheck.workerModel / codecrosscheck.reviewerModel to an available family.`,
      );
    }
    return models[0]! as unknown as LmChat;
  }

  private async sendRaw(messages: ChatMessage[], opts?: SendOptions): Promise<string> {
    throwIfAborted(opts?.signal, this.modelId);
    const vscode = await import("vscode");
    const model = await this.select();
    const lmMessages = messages.map((m) =>
      m.role === "assistant"
        ? vscode.LanguageModelChatMessage.Assistant(m.content)
        : vscode.LanguageModelChatMessage.User(m.content),
    );

    // One source per call, cancelled by the caller's signal and always
    // disposed. The previous implementation created a source nobody could
    // trigger, so stopping a chat response left the loop running.
    const source = new vscode.CancellationTokenSource();
    const onAbort = () => source.cancel();
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await model.sendRequest(
        lmMessages as never[],
        {} as Record<string, never>,
        source.token as never,
      );
      let buf = "";
      for await (const chunk of response.text) {
        buf += chunk;
      }
      throwIfAborted(opts?.signal, this.modelId);
      return buf;
    } catch (err) {
      if (opts?.signal?.aborted) throw new ReviewCancelledError(this.modelId);
      throw err;
    } finally {
      opts?.signal?.removeEventListener("abort", onAbort);
      source.dispose();
    }
  }

  async sendText(messages: ChatMessage[], opts?: SendOptions): Promise<string> {
    return this.sendRaw(messages, opts);
  }

  async sendStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    schemaName: string,
    opts?: SendOptions,
  ): Promise<T> {
    const tryParseOrRefuse = (raw: string): T => {
      // Refusals never become valid JSON — surface them up immediately so the user sees the cause
      // instead of a confusing "Unexpected token 'S'" parse error after a wasted retry.
      assertNotRefusal(raw, this.modelId);
      return schema.parse(JSON.parse(extractJson(raw)));
    };

    let firstRaw = "";
    let firstError: unknown;
    try {
      firstRaw = await this.sendRaw(messages, opts);
      return tryParseOrRefuse(firstRaw);
    } catch (err) {
      if (err instanceof ReviewCancelledError) throw err;
      if (err instanceof ModelRefusalError) throw err;
      // Token-limit failures cannot be fixed by re-asking with the same prompt + a schema reminder.
      // Re-throw as a typed error so callers (and users) see the actual problem instead of a
      // wasted retry that fails the same way.
      assertNotOversized(err, this.modelId);
      firstError = err;
    }

    throwIfAborted(opts?.signal, this.modelId);

    // Show the model what it actually returned and why that failed. A reminder
    // that only names the schema gives it nothing to correct against.
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: firstRaw },
      {
        role: "system",
        content:
          `That response is not valid JSON for schema "${schemaName}". ` +
          `It failed with: ${explainFailure(firstError)}. ` +
          `Reply with ONLY a JSON object validating against this JSON Schema, and nothing else:\n` +
          describeSchema(schema as z.ZodType<unknown>, schemaName),
      },
    ];
    let retryRaw = "";
    try {
      retryRaw = await this.sendRaw(retryMessages, opts);
      return tryParseOrRefuse(retryRaw);
    } catch (err) {
      if (err instanceof ReviewCancelledError) throw err;
      if (err instanceof ModelRefusalError) throw err;
      assertNotOversized(err, this.modelId);
      throw new Error(
        `vscode.lm response failed schema "${schemaName}" twice. ` +
          `First: ${explainFailure(firstError)} (raw: ${snippet(firstRaw)}). ` +
          `Retry: ${explainFailure(err)} (raw: ${snippet(retryRaw)}).`,
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
  constructor(public readonly modelId: string, public override readonly cause: Error) {
    super(
      `Model "${modelId}" rejected the prompt as too large for its context window: ${cause.message}. ` +
        `Shrink the input (e.g. pass diff-base=<closer-ref> to /review-branch, split the branch, ` +
        `or remove large attachments) and try again. Retrying with the same prompt cannot succeed.`,
    );
    this.name = "OversizedPromptError";
  }
}

// Phrases LM providers use when the prompt exceeds the model's context window. Kept conservative
// — we only short-circuit retry on a high-confidence match. Generic transport failures such as
// "context deadline exceeded" (gRPC/HTTP timeout) MUST NOT be classified as oversized; see the
// chat-loop spec scenario "Unrelated failures are not misclassified".
const OVERSIZED_PATTERNS: readonly RegExp[] = [
  /message exceeds (?:the )?token limit/i,
  /context (?:window|length) (?:exceeded|exhausted|too (?:large|long))/i,
  /prompt is too (?:long|large)/i,
  /input (?:is )?too (?:long|large)/i,
  /maximum context length/i,
  /request too large/i,
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
