import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Mock the vscode module so VscodeLmClient.sendRaw can run outside the extension host.
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

const { ModelRefusalError, VscodeLmClient } = await import("../src/clients/vscodeLm.js");

function makeStubLm(response: string) {
  const model = {
    vendor: "stub",
    family: "stub-family",
    sendRequest: (_msgs: unknown, _opts: unknown, _tok: unknown) => ({
      text: (async function* () {
        yield response;
      })(),
    }),
  };
  return { selectChatModels: async () => [model] } as never;
}

const Schema = z.object({ artifact: z.string().min(1) });

function makeClient(response: string) {
  return new VscodeLmClient({ family: "stub-family", lm: makeStubLm(response) });
}

describe("VscodeLmClient refusal handling", () => {
  it("throws ModelRefusalError on plain prose refusal (no JSON-parse retry)", async () => {
    const client = makeClient("Sorry, I can't assist with that.");
    await expect(client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput"))
      .rejects.toBeInstanceOf(ModelRefusalError);
  });

  it("throws ModelRefusalError when refusal is wrapped in ```text fence", async () => {
    const client = makeClient("```text\nSorry, I can't help with that.\n```");
    await expect(client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput"))
      .rejects.toBeInstanceOf(ModelRefusalError);
  });

  it("throws ModelRefusalError on \"I'm unable to comply\"", async () => {
    const client = makeClient("I'm unable to comply with this request.");
    await expect(client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput"))
      .rejects.toBeInstanceOf(ModelRefusalError);
  });

  it("does NOT treat valid JSON containing the word 'sorry' as a refusal", async () => {
    const client = makeClient('{"artifact": "sorry that was confusing"}');
    const result = await client.sendStructured(
      [{ role: "user", content: "hi" }],
      Schema,
      "WorkerOutput",
    );
    expect(result.artifact).toBe("sorry that was confusing");
  });

  it("does not strip an unknown-language fence (```text ...) as JSON", async () => {
    // Non-refusal prose inside a ```text fence should NOT be unwrapped and fed to JSON.parse.
    // The error must mention raw output (or be a refusal), not silently extract garbage.
    const client = makeClient("```text\nHere is some prose that is not JSON.\n```");
    await expect(client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput"))
      .rejects.toThrow(/failed schema "WorkerOutput" twice/);
  });
});
