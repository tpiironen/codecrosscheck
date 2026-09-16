import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import type { ToolCall, ToolContext, ToolResult, ToolSpec } from "../src/clients/ChatClient.js";

/**
 * Contract tests for the tool-call round trip. Both transports run the SAME
 * scenarios, because a capability available on only one surface is how the CLI
 * silently loses a feature the extension has.
 */

// Mock vscode richly enough for the tool loop: the part classes are compared
// with `instanceof`, so they must be real constructors.
class TextPart {
  constructor(public value: string) {}
}
class ToolCallPart {
  constructor(public callId: string, public name: string, public input: object) {}
}
class ToolResultPart {
  constructor(public callId: string, public content: unknown[]) {}
}

vi.mock("vscode", () => ({
  LanguageModelChatMessage: {
    User: (content: unknown) => ({ role: "user", content }),
    Assistant: (content: unknown) => ({ role: "assistant", content }),
  },
  LanguageModelTextPart: TextPart,
  LanguageModelToolCallPart: ToolCallPart,
  LanguageModelToolResultPart: ToolResultPart,
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  CancellationTokenSource: class {
    token = {};
    cancel() {}
    dispose() {}
  },
  lm: {},
}));

const { VscodeLmClient } = await import("../src/clients/vscodeLm.js");
const { OpenAiCompatibleClient } = await import("../src/clients/openaiCompatible.js");

afterEach(() => {
  vi.unstubAllGlobals();
});

const Answer = z.object({ answer: z.string().min(1) });

const SPEC: ToolSpec = {
  name: "read_file",
  description: "read a file",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

/** A scripted model turn: either a set of tool calls, or final text. */
type Turn = { calls: Array<{ id: string; name: string; input: object }> } | { text: string };

/**
 * Pull the next turn the model could actually produce. A request that declares
 * no tools cannot come back with a tool call, so queued call-turns are skipped
 * — which is exactly the situation the budget cut-off creates.
 */
function nextTurn(turns: Turn[], toolsOffered: boolean): Turn {
  while (turns.length > 0) {
    const turn = turns.shift()!;
    if (toolsOffered || !("calls" in turn)) return turn;
  }
  return { text: "" };
}

function recorder() {
  const invoked: ToolCall[] = [];
  const finishes: Array<{ stop: string; callCount: number }> = [];
  const context = (turnsUsed: Partial<ToolContext> = {}): ToolContext => ({
    specs: [SPEC],
    maxCalls: 4,
    deadlineMs: 60_000,
    async invoke(call): Promise<ToolResult> {
      invoked.push(call);
      return { content: `contents of ${JSON.stringify(call.input)}` };
    },
    onFinish: (info) => void finishes.push(info),
    ...turnsUsed,
  });
  return { invoked, finishes, context };
}

/** vscode.lm transport driven by a scripted turn list. */
function vscodeClient(turns: Turn[]) {
  const requests: Array<{ messages: unknown[]; options: Record<string, unknown> }> = [];
  const model = {
    vendor: "stub",
    family: "stub-family",
    sendRequest: (messages: unknown[], options: Record<string, unknown>) => {
      requests.push({ messages: [...messages], options });
      const turn = nextTurn(turns, options.tools !== undefined);
      const parts =
        "calls" in turn
          ? turn.calls.map((c) => new ToolCallPart(c.id, c.name, c.input))
          : [new TextPart(turn.text)];
      return {
        stream: (async function* () {
          for (const p of parts) yield p;
        })(),
        text: (async function* () {
          for (const p of parts) if (p instanceof TextPart) yield p.value;
        })(),
      };
    },
  };
  const client = new VscodeLmClient({ family: "stub-family", lm: { selectChatModels: async () => [model] } as never });
  return { client, requests };
}

/** OpenAI-compatible transport driven by the same scripted turn list. */
function openAiClient(turns: Turn[]) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push(body);
    const turn = nextTurn(turns, body.tools !== undefined);
    const message =
      "calls" in turn
        ? {
            role: "assistant",
            content: null,
            tool_calls: turn.calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
          }
        : { role: "assistant", content: turn.text };
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new OpenAiCompatibleClient({ modelId: "m", baseUrl: "https://x.test/v1", env: {} });
  return { client, bodies };
}

const transports = [
  {
    name: "vscode.lm",
    build: (turns: Turn[]) => vscodeClient(turns).client,
  },
  {
    name: "openai-compatible",
    build: (turns: Turn[]) => openAiClient(turns).client,
  },
];

for (const transport of transports) {
  describe(`tool round trip — ${transport.name}`, () => {
    it("feeds a tool result back and returns the model's next answer", async () => {
      const client = transport.build([
        { calls: [{ id: "c1", name: "read_file", input: { path: "src/a.ts" } }] },
        { text: "the answer" },
      ]);
      const rec = recorder();

      const text = await client.sendText([{ role: "user", content: "go" }], { tools: rec.context() });

      expect(text).toBe("the answer");
      expect(rec.invoked).toHaveLength(1);
      expect(rec.invoked[0]!.name).toBe("read_file");
      expect(rec.invoked[0]!.input).toEqual({ path: "src/a.ts" });
      expect(rec.finishes).toEqual([{ stop: "final", callCount: 1 }]);
    });

    it("answers every call in a multi-call turn", async () => {
      const client = transport.build([
        {
          calls: [
            { id: "c1", name: "read_file", input: { path: "a" } },
            { id: "c2", name: "read_file", input: { path: "b" } },
          ],
        },
        { text: "done" },
      ]);
      const rec = recorder();

      expect(await client.sendText([{ role: "user", content: "go" }], { tools: rec.context() })).toBe("done");
      expect(rec.invoked.map((c) => c.callId)).toEqual(["c1", "c2"]);
    });

    it("stops calling tools once the budget is spent and reports it", async () => {
      // Five call-turns scripted, budget of two: the loop must not consume them all.
      const turns: Turn[] = [];
      for (let i = 0; i < 5; i++) {
        turns.push({ calls: [{ id: `c${i}`, name: "read_file", input: { path: `f${i}` } }] });
      }
      turns.push({ text: "forced answer" });
      const client = transport.build(turns);
      const rec = recorder();

      const text = await client.sendText([{ role: "user", content: "go" }], {
        tools: rec.context({ maxCalls: 2 }),
      });

      expect(text).toBe("forced answer");
      expect(rec.invoked).toHaveLength(2);
      expect(rec.finishes).toEqual([{ stop: "budget-exhausted", callCount: 2 }]);
    });

    it("stops on the wall-clock deadline", async () => {
      const client = transport.build([
        { calls: [{ id: "c1", name: "read_file", input: { path: "a" } }] },
        { text: "timed out answer" },
      ]);
      const rec = recorder();

      const text = await client.sendText([{ role: "user", content: "go" }], {
        tools: rec.context({ deadlineMs: 0 }),
      });

      expect(text).toBe("timed out answer");
      expect(rec.invoked).toHaveLength(0);
      expect(rec.finishes).toEqual([{ stop: "deadline-exceeded", callCount: 0 }]);
    });

    it("parses a structured answer produced after a tool call", async () => {
      const client = transport.build([
        { calls: [{ id: "c1", name: "read_file", input: { path: "a" } }] },
        { text: '{"answer":"grounded"}' },
      ]);
      const rec = recorder();

      const result = await client.sendStructured([{ role: "user", content: "go" }], Answer, "Answer", {
        tools: rec.context(),
      });

      expect(result.answer).toBe("grounded");
      expect(rec.invoked).toHaveLength(1);
    });

    it("makes no tool calls when none are offered", async () => {
      const client = transport.build([{ text: "plain" }]);
      expect(await client.sendText([{ role: "user", content: "go" }])).toBe("plain");
    });

    it("declares no tools when the budget is zero", async () => {
      const client = transport.build([{ text: "no tools for you" }]);
      const rec = recorder();

      const text = await client.sendText([{ role: "user", content: "go" }], {
        tools: rec.context({ maxCalls: 0 }),
      });

      expect(text).toBe("no tools for you");
      expect(rec.invoked).toHaveLength(0);
      // Not a cut-off loop: no loop ran, so there is nothing to report.
      expect(rec.finishes).toEqual([]);
    });
  });
}

describe("tool round trip — transport wire formats", () => {
  it("vscode.lm withdraws the tools on the final cut-off request", async () => {
    const { client, requests } = vscodeClient([
      { calls: [{ id: "c1", name: "read_file", input: { path: "a" } }] },
      { text: "forced" },
    ]);
    const rec = recorder();
    await client.sendText([{ role: "user", content: "go" }], { tools: rec.context({ maxCalls: 1 }) });

    expect(requests[0]!.options.tools).toBeDefined();
    expect(requests[requests.length - 1]!.options.tools).toBeUndefined();
  });

  it("openai-compatible sends tool results as role:tool messages keyed by call id", async () => {
    const { client, bodies } = openAiClient([
      { calls: [{ id: "c1", name: "read_file", input: { path: "a" } }] },
      { text: "done" },
    ]);
    const rec = recorder();
    await client.sendText([{ role: "user", content: "go" }], { tools: rec.context() });

    const second = bodies[1]!.messages as Array<Record<string, unknown>>;
    const toolTurn = second.find((m) => m.role === "tool");
    expect(toolTurn).toBeDefined();
    expect(toolTurn!.tool_call_id).toBe("c1");
  });

  it("openai-compatible hands malformed tool arguments to the tool rather than throwing", async () => {
    const bodies: string[] = [];
    let turn = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(init.body);
        const message =
          turn++ === 0
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "read_file", arguments: "{not json" } },
                ],
              }
            : { role: "assistant", content: "recovered" };
        return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
      }),
    );
    const client = new OpenAiCompatibleClient({ modelId: "m", baseUrl: "https://x.test/v1", env: {} });
    const rec = recorder();

    expect(await client.sendText([{ role: "user", content: "go" }], { tools: rec.context() })).toBe("recovered");
    expect(rec.invoked[0]!.input).toBe("{not json");
  });
});
