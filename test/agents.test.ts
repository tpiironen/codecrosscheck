import { describe, it, expect } from "vitest";
import { buildWorker, buildReviewer } from "../src/agents.js";
import { FakeChatClient } from "./helpers/FakeChatClient.js";

describe("agents", () => {
  it("buildWorker returns the model's text unchanged (no JSON envelope)", async () => {
    const client = new FakeChatClient("worker/fake").enqueue("hello world");
    const worker = buildWorker("plan", client);
    const out = await worker.produce("do thing");
    expect(out).toBe("hello world");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0][0].role).toBe("system");
    expect(client.calls[0][0].content.length).toBeGreaterThan(20);
  });

  it("buildWorker does not unwrap an artifact field", async () => {
    const client = new FakeChatClient("worker/fake").enqueue('{"artifact":"x"}');
    const out = await buildWorker("code", client).produce("do thing");
    expect(out).toBe('{"artifact":"x"}');
  });

  it("buildReviewer parses verdict JSON", async () => {
    const client = new FakeChatClient("reviewer/fake").enqueue({
      verdict: "revise",
      issues: [{ severity: "high", where: "line 3", why: "no tests", suggestion: "add tests" }],
    });
    const reviewer = buildReviewer("code", client);
    const v = await reviewer.judge("some code");
    expect(v.verdict).toBe("revise");
    expect(v.issues[0].severity).toBe("high");
  });
});
