import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import { FakeChatClient } from "./helpers/FakeChatClient.js";
import type { PipelineEvent } from "../src/pipeline.js";

describe("pipeline", () => {
  it("runs plan→code→execute, halts execute by failing approval", async () => {
    const workerClient = new FakeChatClient("worker/fake").enqueueAll([
      { artifact: "PLAN" },
      { artifact: "CODE\n```\nconsole.log(1)\n```" },
      { artifact: "EXEC" },
    ]);
    const reviewerClient = new FakeChatClient("reviewer/fake").enqueueAll([
      { verdict: "approve", issues: [] },
      { verdict: "approve", issues: [] },
      {
        verdict: "revise",
        issues: [{ severity: "high", where: "x", why: "y", suggestion: "z" }],
      },
    ]);
    const events: PipelineEvent[] = [];
    const result = await runPipeline("do the thing", {
      workerClient,
      reviewerClient,
      maxIters: 1,
      onEvent: (e) => events.push(e),
    });
    expect(result.approved).toBe(false);
    expect(result.stages.map((s) => s.stage)).toEqual(["plan", "code", "execute"]);
    expect(result.stages[2].sandbox).toBeUndefined();
    expect(events.find((e) => e.type === "completed")?.type).toBe("completed");
  });
});
