import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  extractFixProposal,
  findLatestTranscript,
  type FsLike,
} from "../src/applyReview.js";

/**
 * Contract test for `/openspec-review` transcript format.
 *
 * The chat handler (`handleOpenSpecReview` in `src/extension.ts`) writes
 * transcript events in a specific JSONL shape so that `/apply-review` can
 * consume the result without modification:
 *
 *   - one `review-branch-iter` per CODE-stage worker artifact with
 *     `role: "worker"` and `artifact: <code-stage artifact string>`
 *   - one `review-branch-iter` per CODE-stage reviewer verdict with
 *     `role: "reviewer"`, `verdict`, `source`, `changeId`
 *   - one terminating `review-branch-done` with `approved`, `iterations`,
 *     `elapsedMs`, `changeId`
 *
 * This test reconstructs the exact event sequence the handler emits and
 * verifies it round-trips through `findLatestTranscript` and
 * `extractFixProposal`. If either side drifts, this fails.
 */

const RUNS = path.resolve("/runs");
const runs = (rel: string): string => path.resolve(RUNS, rel);

function makeFakeFs(initial: {
  dirs?: Record<string, string[]>;
  files?: Record<string, string>;
  mtimes?: Record<string, number>;
}): FsLike {
  const dirs = new Map<string, string[]>(Object.entries(initial.dirs ?? {}));
  const files = new Map<string, string>(Object.entries(initial.files ?? {}));
  const mtimes = new Map<string, number>(Object.entries(initial.mtimes ?? {}));
  return {
    async readDir(dir) {
      return dirs.get(dir) ?? [];
    },
    async stat(p) {
      return { mtimeMs: mtimes.get(p) ?? 0 };
    },
    async readFile(p) {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    async writeFile() {
      /* unused */
    },
    async exists(p) {
      return files.has(p) || dirs.has(p);
    },
  };
}

/** Build the JSONL exactly as `handleOpenSpecReview` writes it. */
function buildOpenSpecReviewTranscript(
  changeId: string,
  codeArtifact: string,
): string {
  const lines = [
    // Pipeline events as written by `createPipelineEventHandler`.
    JSON.stringify({ event: "stage-start", stage: "plan", workerId: "w", reviewerId: "r" }),
    JSON.stringify({ event: "iteration-start", stage: "plan", iteration: 1, maxIters: 3 }),
    JSON.stringify({ event: "worker", stage: "plan", iteration: 1, modelId: "w", artifact: "plan text" }),
    JSON.stringify({
      event: "verdict",
      stage: "plan",
      iteration: 1,
      modelId: "r",
      verdict: { verdict: "approve", issues: [] },
      source: "model",
    }),
    JSON.stringify({ event: "stage-end", stage: "plan", approved: true, iterations: 1 }),
    JSON.stringify({ event: "stage-start", stage: "code", workerId: "w", reviewerId: "r" }),
    JSON.stringify({ event: "iteration-start", stage: "code", iteration: 1, maxIters: 3 }),
    JSON.stringify({ event: "worker", stage: "code", iteration: 1, modelId: "w", artifact: codeArtifact }),
    // The translator inside `handleOpenSpecReview` emits these alongside the
    // raw pipeline event for CODE-stage worker artifacts.
    JSON.stringify({
      event: "review-branch-iter",
      iteration: 1,
      role: "worker",
      workerId: "w",
      artifact: codeArtifact,
    }),
    JSON.stringify({
      event: "verdict",
      stage: "code",
      iteration: 1,
      modelId: "r",
      verdict: { verdict: "approve", issues: [] },
      source: "model",
    }),
    JSON.stringify({
      event: "review-branch-iter",
      iteration: 1,
      role: "reviewer",
      reviewerId: "r",
      verdict: { verdict: "approve", issues: [] },
      source: "model",
      changeId,
    }),
    JSON.stringify({ event: "stage-end", stage: "code", approved: true, iterations: 1 }),
    JSON.stringify({
      event: "review-branch-done",
      approved: true,
      iterations: 1,
      elapsedMs: 1234,
      changeId,
    }),
  ];
  return lines.join("\n") + "\n";
}

describe("openspec-review transcript contract", () => {
  it("transcript is discoverable by findLatestTranscript", async () => {
    const transcript = buildOpenSpecReviewTranscript(
      "add-foo",
      "## Fix\n// path: src/a.ts\n\n```ts\nexport const x = 1;\n```",
    );
    const fs = makeFakeFs({
      dirs: { [RUNS]: ["openspec-run.jsonl"] },
      files: { [runs("openspec-run.jsonl")]: transcript },
      mtimes: { [runs("openspec-run.jsonl")]: 100 },
    });
    const result = await findLatestTranscript(RUNS, fs);
    expect(result).toContain("openspec-run.jsonl");
  });

  it("extractFixProposal returns the CODE-stage worker artifact", async () => {
    const codeArtifact = "## Fix\n// path: src/feature.ts\n\n```ts\nexport function feature(): void {}\n```";
    const transcript = buildOpenSpecReviewTranscript("add-feature", codeArtifact);
    const p = path.resolve("/t.jsonl");
    const fs = makeFakeFs({ files: { [p]: transcript } });
    const result = await extractFixProposal(p, fs);
    expect(result).not.toBeNull();
    expect(result?.proposal).toBe(codeArtifact);
    expect(result?.verdict?.verdict).toBe("approve");
  });

  it("ignores PLAN-stage worker artifacts (no review-branch-iter emitted for them)", async () => {
    // Plan stage emits only the raw `worker` pipeline event, never a
    // `review-branch-iter`. `extractFixProposal` filters on
    // `review-branch-iter` + `role: worker`, so plan artifacts must not
    // leak through as the candidate code artifact.
    const codeArtifact = "code-stage artifact";
    const transcript = buildOpenSpecReviewTranscript("add-foo", codeArtifact);
    const p = path.resolve("/t.jsonl");
    const fs = makeFakeFs({ files: { [p]: transcript } });
    const result = await extractFixProposal(p, fs);
    expect(result?.proposal).toBe(codeArtifact);
    expect(result?.proposal).not.toContain("plan text");
  });
});
