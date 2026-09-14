import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Mock vscode so VscodeLmClient.sendRaw runs outside the extension host.
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

const { OversizedPromptError, VscodeLmClient, assertNotOversized } = await import(
  "../src/clients/vscodeLm.js"
);

function makeThrowingLm(message: string, sendSpy?: (...args: unknown[]) => void) {
  const model = {
    vendor: "stub",
    family: "stub-family",
    sendRequest: (msgs: unknown, opts: unknown, tok: unknown) => {
      sendSpy?.(msgs, opts, tok);
      throw new Error(message);
    },
  };
  return { selectChatModels: async () => [model] } as never;
}

const Schema = z.object({ artifact: z.string().min(1) });

describe("VscodeLmClient oversized-prompt handling", () => {
  it("throws OversizedPromptError on first attempt without retrying (Message exceeds token limit)", async () => {
    const spy = vi.fn();
    const client = new VscodeLmClient({
      family: "stub-family",
      lm: makeThrowingLm("Message exceeds token limit.", spy),
    });
    await expect(
      client.sendStructured([{ role: "user", content: "hi" }], Schema, "WorkerOutput"),
    ).rejects.toBeInstanceOf(OversizedPromptError);
    // Critical: must NOT call the model a second time with the schema-reminder retry.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("matches several token-limit phrasings used by LM providers", async () => {
    const phrases = [
      "Message exceeds token limit.",
      "This model's maximum context length is 8192 tokens.",
      "Prompt is too long for this model.",
      "Request too large for this context window.",
      "context window exceeded",
    ];
    for (const p of phrases) {
      expect(() => assertNotOversized(new Error(p), "stub/stub")).toThrow(OversizedPromptError);
    }
  });

  it("ignores unrelated errors (does NOT misclassify generic failures as oversized)", () => {
    expect(() => assertNotOversized(new Error("ECONNRESET"), "stub/stub")).not.toThrow();
    expect(() => assertNotOversized(new Error("Unexpected token 'S' in JSON"), "stub/stub")).not.toThrow();
    // Regression: gRPC/HTTP deadline-exceeded must not be misclassified as an oversized prompt.
    expect(() => assertNotOversized(new Error("context deadline exceeded"), "stub/stub")).not.toThrow();
    expect(() => assertNotOversized(new Error("deadline exceeded after 30s"), "stub/stub")).not.toThrow();
  });

  it("OversizedPromptError message names the model and suggests remediation", () => {
    const err = new OversizedPromptError("copilot/gpt-5.5", new Error("Message exceeds token limit."));
    expect(err.message).toContain("copilot/gpt-5.5");
    expect(err.message).toContain("diff-base");
  });
});
