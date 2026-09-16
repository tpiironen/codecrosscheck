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

/** A tool offered to the model, described by a JSON Schema for its input. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  callId: string;
  name: string;
  /** Provider-decoded arguments. A string means the provider sent unparseable JSON. */
  input: unknown;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

/** How a tool loop ended. Anything but `final` means the model was cut off. */
export type ToolLoopStop = "final" | "budget-exhausted" | "deadline-exceeded";

export interface ToolContext {
  specs: ToolSpec[];
  invoke(call: ToolCall): Promise<ToolResult>;
  /** Hard cap on tool calls for one send. Defaults to `DEFAULT_TOOL_MAX_CALLS`. */
  maxCalls?: number;
  /** Wall-clock cap measured from the first request. Defaults to `DEFAULT_TOOL_DEADLINE_MS`. */
  deadlineMs?: number;
  /** Invoked after every tool call so the caller can record it. */
  onCall?(call: ToolCall, result: ToolResult): void;
  /** Invoked once when the loop ends, whether or not it ran to completion. */
  onFinish?(info: { stop: ToolLoopStop; callCount: number }): void;
}

/**
 * Answer given to a tool call the model requested after the budget was spent.
 * The call must still be answered — a provider rejects a follow-up request
 * that leaves one unanswered — but it is not executed.
 */
export const TOOL_BUDGET_REFUSAL =
  "Not executed: the tool-call budget for this turn is exhausted. Answer from what you already have.";

export const DEFAULT_TOOL_MAX_CALLS = 24;
export const DEFAULT_TOOL_DEADLINE_MS = 180_000;

export interface SendOptions {
  signal?: AbortSignal;
  /** When set, the client runs a tool-call round trip before producing its answer. */
  tools?: ToolContext;
}

/** Mutable budget state for one tool loop. */
export interface ToolBudget {
  maxCalls: number;
  deadlineAt: number;
  calls: number;
}

export function openToolBudget(tools: ToolContext): ToolBudget {
  return {
    maxCalls: tools.maxCalls ?? DEFAULT_TOOL_MAX_CALLS,
    deadlineAt: Date.now() + (tools.deadlineMs ?? DEFAULT_TOOL_DEADLINE_MS),
    calls: 0,
  };
}

/** A zero budget means the user switched tools off; don't declare any. */
export function toolsEnabled(tools: ToolContext | undefined): tools is ToolContext {
  return tools !== undefined && tools.specs.length > 0 && (tools.maxCalls ?? DEFAULT_TOOL_MAX_CALLS) > 0;
}

/** `null` while the loop may continue; otherwise the reason it must stop. */
export function budgetExceeded(b: ToolBudget, now = Date.now()): ToolLoopStop | null {
  if (b.calls >= b.maxCalls) return "budget-exhausted";
  if (now >= b.deadlineAt) return "deadline-exceeded";
  return null;
}

/**
 * The turn appended when a loop is cut off. Tools are withdrawn for the final
 * request, so the model cannot spend another call it no longer has; without
 * this it would answer with a tool call and leave `sendStructured` nothing to
 * parse.
 */
export function toolBudgetNudge(stop: ToolLoopStop, b: ToolBudget): string {
  const cause =
    stop === "budget-exhausted"
      ? `You have used all ${b.maxCalls} of your tool calls.`
      : `The time limit for gathering data has passed.`;
  return (
    `${cause} No further tool calls are available. Answer now using only what you already have. ` +
    `If something remains unverified, say so explicitly rather than assuming it.`
  );
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
