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

    const extractJson = (raw: string): string => {
      // The model may wrap JSON in fences or prose. Extract the largest JSON object substring.
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence?.[1]) return fence[1].trim();
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first >= 0 && last > first) return raw.slice(first, last + 1);
      return raw.trim();
    };

    const tryParse = (raw: string): T => schema.parse(JSON.parse(extractJson(raw)));

    let firstError: unknown;
    try {
      return tryParse(await send(messages));
    } catch (err) {
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
    try {
      return tryParse(await send(retryMessages));
    } catch (err) {
      throw new Error(
        `vscode.lm response failed schema "${schemaName}" twice. ` +
          `First: ${(firstError as Error)?.message}. Retry: ${(err as Error)?.message}`,
      );
    }
  }
}

function schemaDescription(schema: z.ZodSchema<unknown>): string {
  // Best-effort textual hint; the JSON-schema generator is used in the GitHub Models path.
  return schema.description ?? "the previously stated structured-verdict schema";
}
