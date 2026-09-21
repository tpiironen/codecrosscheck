import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  OpenAiCompatibleClient,
  chatCompletionsUrl,
  resolveApiKey,
  resolveBaseUrl,
  BASE_URL_ENV,
} from "../src/clients/openaiCompatible.js";
import { satisfiesStrictMode, toProviderJsonSchema } from "../src/clients/schemaText.js";
import { FixProposalSchema, TriageSchema, VerdictSchema } from "../src/schemas.js";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("endpoint construction", () => {
  it("appends /chat/completions to an API root", () => {
    expect(chatCompletionsUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(chatCompletionsUrl("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });

  it("does not double the suffix when the full URL is given", () => {
    expect(chatCompletionsUrl("https://x.test/v1/chat/completions")).toBe(
      "https://x.test/v1/chat/completions",
    );
  });
});

describe("configuration resolution", () => {
  it("prefers the explicit base URL over the environment", () => {
    expect(resolveBaseUrl("https://explicit.test", { [BASE_URL_ENV]: "https://env.test" })).toBe(
      "https://explicit.test",
    );
  });

  it("has no provider default", () => {
    expect(resolveBaseUrl(undefined, {})).toBeNull();
  });

  it("falls back from CODECROSSCHECK_API_KEY to OPENAI_API_KEY", () => {
    expect(resolveApiKey(undefined, { OPENAI_API_KEY: "sk-openai" })).toBe("sk-openai");
    expect(
      resolveApiKey(undefined, { CODECROSSCHECK_API_KEY: "sk-ccc", OPENAI_API_KEY: "sk-openai" }),
    ).toBe("sk-ccc");
  });

  it("treats whitespace as absent", () => {
    expect(resolveApiKey(undefined, { CODECROSSCHECK_API_KEY: "   " })).toBeNull();
    expect(resolveBaseUrl(undefined, { [BASE_URL_ENV]: "  " })).toBeNull();
  });
});

describe("OpenAiCompatibleClient", () => {
  it("throws a named error when no base URL is configured", () => {
    expect(() => new OpenAiCompatibleClient({ modelId: "m", env: {} })).toThrow(BASE_URL_ENV);
  });

  it("sends Authorization when a key is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok("hi"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAiCompatibleClient({
      modelId: "m",
      env: { [BASE_URL_ENV]: "https://api.test/v1", CODECROSSCHECK_API_KEY: "sk-1" },
    });
    await client.sendText([{ role: "user", content: "x" }]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer sk-1" });
  });

  it("omits Authorization entirely when no key is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok("hi"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAiCompatibleClient({
      modelId: "m",
      env: { [BASE_URL_ENV]: "http://localhost:11434/v1" },
    });
    await client.sendText([{ role: "user", content: "x" }]);

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    // An empty or placeholder credential would be rejected by keyless servers.
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("names the endpoint in a transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 502 })),
    );
    const client = new OpenAiCompatibleClient({
      modelId: "m",
      env: { [BASE_URL_ENV]: "https://api.test/v1" },
    });
    await expect(client.sendText([{ role: "user", content: "x" }])).rejects.toThrow(
      /https:\/\/api\.test\/v1\/chat\/completions.*502/s,
    );
  });
});

describe("structured retry when the first attempt produced no response", () => {
  const client = () =>
    new OpenAiCompatibleClient({
      modelId: "m",
      env: { [BASE_URL_ENV]: "https://api.test/v1" },
    });

  const bodyOf = (call: unknown[]) =>
    JSON.parse((call[1] as RequestInit).body as string) as {
      messages: Array<{ role: string; content?: string }>;
    };

  it("re-sends the original messages instead of describing a response that never arrived", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503 }))
      .mockResolvedValueOnce(ok('{"artifact":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const schema = z.object({ artifact: z.string().min(1) });
    const result = await client().sendStructured(
      [{ role: "user", content: "hi" }],
      schema,
      "WorkerOutput",
    );

    expect(result.artifact).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retry = bodyOf(fetchMock.mock.calls[1]!);
    expect(retry.messages.some((m) => m.role === "assistant")).toBe(false);
    expect(retry.messages.some((m) => m.content?.includes("not valid JSON"))).toBe(false);
    expect(retry.messages).toEqual(bodyOf(fetchMock.mock.calls[0]!).messages);
  });

  it("still echoes the response when the first attempt did return text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok("not json at all"))
      .mockResolvedValueOnce(ok('{"artifact":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);

    const schema = z.object({ artifact: z.string().min(1) });
    await client().sendStructured([{ role: "user", content: "hi" }], schema, "WorkerOutput");

    const retry = bodyOf(fetchMock.mock.calls[1]!);
    expect(retry.messages.find((m) => m.role === "assistant")?.content).toBe("not json at all");
  });
});

describe("structured-output schema generation", () => {
  // FixProposalSchema carries a `.refine` that JSON Schema cannot express. The
  // provider request is built from `toProviderJsonSchema`, so if generation
  // threw or mis-reported strict mode, every CLI fixer call would fail at
  // runtime with nothing catching it here.
  it("generates a provider schema for every schema sent to a provider", () => {
    for (const [name, schema] of [
      ["FixProposal", FixProposalSchema],
      ["Verdict", VerdictSchema],
      ["Triage", TriageSchema],
    ] as const) {
      const generated = toProviderJsonSchema(schema, name);
      expect(generated.title, name).toBe(name);
      expect(generated.type, name).toBe("object");
    }
  });

  it("keeps FixProposal eligible for strict mode", () => {
    const generated = toProviderJsonSchema(FixProposalSchema, "FixProposal");
    expect(satisfiesStrictMode(generated)).toBe(true);
    const props = Object.keys(generated.properties as Record<string, unknown>);
    expect(props.sort()).toEqual(["fixes", "summary"]);
  });

  it("does not claim the refinement is enforced by the provider", () => {
    // The empty-edits invariant is a zod check, not a JSON Schema constraint:
    // the provider cannot enforce it, so the runtime gate must stay.
    const generated = toProviderJsonSchema(FixProposalSchema, "FixProposal");
    expect(JSON.stringify(generated)).not.toContain("must be empty unless");
  });
});
