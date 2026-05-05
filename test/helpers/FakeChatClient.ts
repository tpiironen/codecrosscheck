import type { z } from "zod";
import type { ChatClient, ChatMessage } from "../../src/clients/ChatClient.js";

/**
 * Test double: returns scripted responses in FIFO order. Each enqueued value
 * is parsed by the schema (if a string, JSON.parse is attempted first). If a
 * raw object is enqueued, it is validated directly. If a thrown Error is
 * enqueued, it is thrown — useful to test retry/error paths.
 */
export class FakeChatClient implements ChatClient {
  public readonly modelId: string;
  public readonly calls: ChatMessage[][] = [];
  private readonly queue: unknown[] = [];

  constructor(modelId = "fake/model") {
    this.modelId = modelId;
  }

  enqueue(value: unknown): this {
    this.queue.push(value);
    return this;
  }

  enqueueAll(values: unknown[]): this {
    for (const v of values) this.queue.push(v);
    return this;
  }

  async sendStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodSchema<T>,
    _schemaName: string,
  ): Promise<T> {
    this.calls.push(messages);
    if (this.queue.length === 0) {
      throw new Error("FakeChatClient: response queue is empty");
    }
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    let raw: unknown = next;
    if (typeof next === "string") {
      try {
        raw = JSON.parse(next);
      } catch (err) {
        throw new Error(`FakeChatClient: enqueued string is not JSON: ${(err as Error).message}`);
      }
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`FakeChatClient: scripted response failed schema: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async sendText(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    if (this.queue.length === 0) {
      throw new Error("FakeChatClient: response queue is empty");
    }
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === "string" ? next : JSON.stringify(next);
  }
}
