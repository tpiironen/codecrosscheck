import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatClient {
  /**
   * Send messages and parse the response as a structured object validated by the supplied zod schema.
   * Implementations SHOULD retry once with a schema-restating follow-up on parse failure.
   */
  sendStructured<T>(messages: ChatMessage[], schema: z.ZodSchema<T>, schemaName: string): Promise<T>;

  /** Send messages and return the raw text response. No JSON parsing. */
  sendText(messages: ChatMessage[]): Promise<string>;

  /** Identifier of the underlying model, for logging. */
  readonly modelId: string;
}
