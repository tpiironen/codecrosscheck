import { describe, expect, it } from "vitest";
import { reviewLoop } from "../src/loop.js";
import { runPipeline } from "../src/pipeline.js";
import { FakeChatClient } from "./helpers/FakeChatClient.js";
import type { Verdict } from "../src/schemas.js";

const revise: Verdict = {
  verdict: "revise",
  issues: [{ severity: "low", where: "x", why: "y", suggestion: "z" }],
};

function agents(onProduce?: () => void) {
  let produced = 0;
  let judged = 0;
  return {
    counts: () => ({ produced, judged }),
    worker: {
      modelId: "w",
      async produce(): Promise<string> {
        produced++;
        onProduce?.();
        return `artifact ${produced}`;
      },
    },
    reviewer: {
      modelId: "r",
      async judge(): Promise<Verdict> {
        judged++;
        return revise;
      },
    },
  };
}

describe("reviewLoop cancellation", () => {
  it("stops between iterations and returns the work done so far", async () => {
    const controller = new AbortController();
    const a = agents(() => controller.abort());
    const result = await reviewLoop("task", {
      worker: a.worker,
      reviewer: a.reviewer,
      maxIters: 5,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.approved).toBe(false);
    // Aborted during the first worker call, so the reviewer was never asked.
    expect(a.counts().judged).toBe(0);
    expect(result.iterations).toBe(0);
  });

  it("does not start at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const a = agents();
    const result = await reviewLoop("task", {
      worker: a.worker,
      reviewer: a.reviewer,
      maxIters: 5,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(a.counts().produced).toBe(0);
  });

  it("runs normally when the signal never aborts", async () => {
    const a = agents();
    const result = await reviewLoop("task", {
      worker: a.worker,
      reviewer: a.reviewer,
      maxIters: 2,
      signal: new AbortController().signal,
    });
    expect(result.cancelled).toBe(false);
    expect(result.iterations).toBe(2);
    expect(a.counts().judged).toBe(2);
  });

  it("reports cancelled=false for an ordinary approval", async () => {
    const result = await reviewLoop("task", {
      worker: { modelId: "w", produce: async () => "art" },
      reviewer: { modelId: "r", judge: async () => ({ verdict: "approve", issues: [] }) },
      maxIters: 3,
    });
    expect(result.approved).toBe(true);
    expect(result.cancelled).toBe(false);
  });
});

describe("runPipeline cancellation", () => {
  it("does not start the next stage after an abort", async () => {
    const controller = new AbortController();
    const worker = new FakeChatClient("w").enqueueAll(["plan text", "code text"]);
    const reviewer = new FakeChatClient("r").enqueueAll([
      { verdict: "approve", issues: [] },
      { verdict: "approve", issues: [] },
    ]);

    const stagesSeen: string[] = [];
    const result = await runPipeline("task", {
      workerClient: worker,
      reviewerClient: reviewer,
      stages: ["plan", "code"],
      maxIters: 1,
      signal: controller.signal,
      onEvent: (ev) => {
        if (ev.type === "stage-end") {
          stagesSeen.push(ev.stage);
          controller.abort();
        }
      },
    });

    expect(stagesSeen).toEqual(["plan"]);
    expect(result.cancelled).toBe(true);
    expect(result.stages).toHaveLength(1);
  });

  it("completes both stages when not cancelled", async () => {
    const worker = new FakeChatClient("w").enqueueAll(["plan text", "code text"]);
    const reviewer = new FakeChatClient("r").enqueueAll([
      { verdict: "approve", issues: [] },
      { verdict: "approve", issues: [] },
    ]);
    const result = await runPipeline("task", {
      workerClient: worker,
      reviewerClient: reviewer,
      stages: ["plan", "code"],
      maxIters: 1,
    });
    expect(result.approved).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.stages).toHaveLength(2);
  });
});
