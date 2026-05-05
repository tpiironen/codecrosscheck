import { describe, it, expect } from "vitest";
import { reviewLoop } from "../src/loop.js";
import type { Worker, Reviewer } from "../src/agents.js";
import type { Verdict } from "../src/schemas.js";

function scriptedWorker(outputs: string[]): Worker {
  let i = 0;
  return {
    modelId: "worker/fake",
    async produce(_input: string): Promise<string> {
      const out = outputs[Math.min(i, outputs.length - 1)];
      i++;
      return out;
    },
  };
}

function scriptedReviewer(verdicts: Verdict[]): Reviewer {
  let i = 0;
  return {
    modelId: "reviewer/fake",
    async judge(_artifact: string): Promise<Verdict> {
      const v = verdicts[Math.min(i, verdicts.length - 1)];
      i++;
      return v;
    },
  };
}

describe("reviewLoop", () => {
  it("returns immediately when reviewer approves on first pass", async () => {
    const worker = scriptedWorker(["draft-1"]);
    const reviewer = scriptedReviewer([{ verdict: "approve", issues: [] }]);
    const r = await reviewLoop("task", { worker, reviewer, maxIters: 3 });
    expect(r.approved).toBe(true);
    expect(r.iterations).toBe(1);
    expect(r.artifact).toBe("draft-1");
  });

  it("loops on revise, then approves", async () => {
    const worker = scriptedWorker(["draft-1", "draft-2"]);
    const reviewer = scriptedReviewer([
      {
        verdict: "revise",
        issues: [{ severity: "medium", where: "x", why: "y", suggestion: "z" }],
      },
      { verdict: "approve", issues: [] },
    ]);
    const r = await reviewLoop("task", { worker, reviewer, maxIters: 3 });
    expect(r.approved).toBe(true);
    expect(r.iterations).toBe(2);
    expect(r.artifact).toBe("draft-2");
    expect(r.history).toHaveLength(2);
  });

  it("stops at maxIters when never approved", async () => {
    const worker = scriptedWorker(["d1", "d2", "d3", "d4"]);
    const reviewer = scriptedReviewer([
      { verdict: "revise", issues: [{ severity: "low", where: "a", why: "b", suggestion: "c" }] },
    ]);
    const r = await reviewLoop("task", { worker, reviewer, maxIters: 3 });
    expect(r.approved).toBe(false);
    expect(r.iterations).toBe(3);
    expect(r.history).toHaveLength(3);
  });

  it("preReview short-circuits and skips reviewer", async () => {
    const worker = scriptedWorker(["d1", "d2"]);
    let reviewerCalls = 0;
    const reviewer: Reviewer = {
      modelId: "reviewer/fake",
      async judge() {
        reviewerCalls++;
        return { verdict: "approve", issues: [] };
      },
    };
    const validatorVerdict: Verdict = {
      verdict: "revise",
      issues: [{ severity: "high", where: "validator", why: "fail", suggestion: "fix it" }],
    };
    let calls = 0;
    const r = await reviewLoop("task", {
      worker,
      reviewer,
      maxIters: 2,
      preReview: () => {
        calls++;
        // first iter: validator fails. second iter: pass through to reviewer.
        return calls === 1 ? validatorVerdict : null;
      },
    });
    expect(reviewerCalls).toBe(1); // only second iter hit the reviewer
    expect(r.history[0].source).toBe("validator");
    expect(r.history[1].source).toBe("model");
    expect(r.approved).toBe(true);
  });
});
