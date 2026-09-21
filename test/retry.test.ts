import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Mock vscode so VscodeLmClient.sendRaw can run outside the extension host.
vi.mock("vscode", () => ({
  LanguageModelChatMessage: {
    User: (content: string) => ({ role: "user", content }),
    Assistant: (content: string) => ({ role: "assistant", content }),
  },
  CancellationTokenSource: class {
    token = {};
    cancel() {}
    dispose() {}
  },
  lm: {},
}));

const { VscodeLmClient } = await import("../src/clients/vscodeLm.js");
const { describeSchema, explainFailure } = await import("../src/clients/schemaText.js");

const Schema = z.object({ artifact: z.string().min(1) });

/** Records every message list the model was sent, and replays scripted responses. */
function makeRecordingLm(responses: string[]) {
  const sent: Array<Array<{ role: string; content: string }>> = [];
  const model = {
    vendor: "stub",
    family: "stub-family",
    sendRequest: (msgs: Array<{ role: string; content: string }>) => {
      sent.push(msgs);
      const next = responses.shift() ?? "";
      return {
        text: (async function* () {
          yield next;
        })(),
      };
    },
  };
  return { lm: { selectChatModels: async () => [model] } as never, sent };
}

describe("structured-output retry shows the model its own failure", () => {
  it("echoes the failed response back as an assistant turn", async () => {
    const { lm, sent } = makeRecordingLm(["not json at all", '{"artifact":"ok"}']);
    const client = new VscodeLmClient({ family: "stub-family", lm });

    const result = await client.sendStructured(
      [{ role: "user", content: "hi" }],
      Schema,
      "WorkerOutput",
    );

    expect(result.artifact).toBe("ok");
    expect(sent).toHaveLength(2);
    const retry = sent[1]!;
    const assistantTurn = retry.find((m) => m.role === "assistant");
    expect(assistantTurn, "retry must replay the failed response").toBeDefined();
    expect(assistantTurn!.content).toBe("not json at all");
  });

  it("includes the parse error text in the retry", async () => {
    const { lm, sent } = makeRecordingLm(["not json at all", '{"artifact":"ok"}']);
    const client = new VscodeLmClient({ family: "stub-family", lm });
    await client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput");

    // vscode.lm has no system role, so the reminder is delivered as a user turn.
    const reminder = sent[1]!.find((m) => m.content.includes("not valid JSON"));
    expect(reminder, "retry must carry a reminder naming the failure").toBeDefined();
    expect(reminder!.content).toMatch(/It failed with: .+/);
  });

  it("includes the validation error when JSON parses but fails the schema", async () => {
    // `artifact` is empty, so JSON.parse succeeds and zod rejects it.
    const { lm, sent } = makeRecordingLm(['{"artifact":""}', '{"artifact":"ok"}']);
    const client = new VscodeLmClient({ family: "stub-family", lm });
    await client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput");

    const reminder = sent[1]!.find((m) => m.content.includes("It failed with"));
    expect(reminder).toBeDefined();
    expect(reminder!.content).toContain("artifact");
  });

  it("states the schema rather than referring to it vaguely", async () => {
    const { lm, sent } = makeRecordingLm(["nope", '{"artifact":"ok"}']);
    const client = new VscodeLmClient({ family: "stub-family", lm });
    await client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput");

    const reminder = sent[1]!.find((m) => m.content.includes("not valid JSON"))!;
    // The old implementation fell back to this sentence for every schema.
    expect(reminder.content).not.toContain("previously stated structured-verdict schema");
    expect(reminder.content).toContain("artifact");
    expect(reminder.content).toContain("properties");
  });
});

describe("a first attempt that produced nothing is re-sent, not described", () => {
  /** First `sendRequest` throws before yielding text; the second succeeds. */
  function makeThrowingThenOkLm(error: Error, then: string) {
    const sent: Array<Array<{ role: string; content: string }>> = [];
    const model = {
      vendor: "stub",
      family: "stub-family",
      sendRequest: (msgs: Array<{ role: string; content: string }>) => {
        sent.push(msgs);
        if (sent.length === 1) throw error;
        return {
          text: (async function* () {
            yield then;
          })(),
        };
      },
    };
    return { lm: { selectChatModels: async () => [model] } as never, sent };
  }

  // Wording must not collide with the oversized-prompt or refusal patterns,
  // which short-circuit the retry before it is ever built.
  const transportFailure = () => new Error("Model request failed (503): upstream unavailable");

  it("re-sends the original messages, inventing no turn and no failure", async () => {
    const { lm, sent } = makeThrowingThenOkLm(transportFailure(), '{"artifact":"ok"}');
    const client = new VscodeLmClient({ family: "stub-family", lm });

    const result = await client.sendStructured(
      [{ role: "user", content: "hi" }],
      Schema,
      "WorkerOutput",
    );

    expect(result.artifact).toBe("ok");
    expect(sent).toHaveLength(2);
    // Strict equality is the real assertion; the two named ones below say
    // which defect each half of it guards against.
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[1]!.some((m) => m.role === "assistant")).toBe(false);
    expect(sent[1]!.some((m) => m.content.includes("not valid JSON"))).toBe(false);
  });

  it("still reports the originating failure when the retry also fails", async () => {
    const { lm } = makeThrowingThenOkLm(transportFailure(), "still not json");
    const client = new VscodeLmClient({ family: "stub-family", lm });

    await expect(
      client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput"),
    ).rejects.toThrow(/upstream unavailable/);
  });
});

describe("schemaText helpers", () => {
  it("describeSchema generates a description from the schema itself", () => {
    const text = describeSchema(Schema, "WorkerOutput");
    expect(text).toContain("artifact");
    expect(text).toContain("WorkerOutput");
  });

  it("explainFailure renders zod issues with their paths", () => {
    const err = Schema.safeParse({ artifact: 123 });
    expect(err.success).toBe(false);
    const text = explainFailure(err.success ? null : err.error);
    expect(text).toContain("artifact");
  });

  it("explainFailure falls back to the message for non-zod errors", () => {
    expect(explainFailure(new Error("boom"))).toBe("boom");
  });
});
