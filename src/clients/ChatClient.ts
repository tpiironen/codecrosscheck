import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Thrown when a run is cancelled. Distinct from a failure — nothing went wrong. */
export class ReviewCancelledError extends Error {
  constructor(modelId?: string) {
    super(modelId ? `Run cancelled while waiting on "${modelId}".` : "Run cancelled.");
    this.name = "ReviewCancelledError";
  }
}

export interface SendOptions {
  signal?: AbortSignal;
}

export interface ChatClient {
  /**
   * Send messages and parse the response as a structured object validated by the supplied zod schema.
   * Implementations SHOULD retry once on parse failure, showing the model its own failed response.
   */
  sendStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodSchema<T>,
    schemaName: string,
    opts?: SendOptions,
  ): Promise<T>;

  /** Send messages and return the raw text response. No JSON parsing. */
  sendText(messages: ChatMessage[], opts?: SendOptions): Promise<string>;

  /** Identifier of the underlying model, for logging. */
  readonly modelId: string;
}

export function throwIfAborted(signal: AbortSignal | undefined, modelId?: string): void {
  if (signal?.aborted) throw new ReviewCancelledError(modelId);
}
