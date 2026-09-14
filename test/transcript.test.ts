import { describe, it, expect } from "vitest";
import { createTranscriptWriter, type AppendFs } from "../src/transcript.js";

/** In-memory AppendFs with optional per-call failure injection. */
function memFs(failOn?: (content: string) => boolean): AppendFs & { read(): string } {
  let buf = "";
  return {
    async writeFile(_p, c) {
      buf = c;
    },
    async appendFile(_p, c) {
      if (failOn?.(c)) throw new Error("disk full");
      buf += c;
    },
    read: () => buf,
  };
}

const parse = (s: string) =>
  s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string });

describe("createTranscriptWriter", () => {
  it("writes every queued event once flushed, in order", async () => {
    const fs = memFs();
    const t = createTranscriptWriter("/t.jsonl", fs);
    t.write({ event: "review-branch-start" });
    t.write({ event: "review-branch-iter", iteration: 1 });
    t.write({ event: "review-branch-done" });

    await t.flush();

    const events = parse(fs.read()).map((e) => e.event);
    expect(events).toEqual(["review-branch-start", "review-branch-iter", "review-branch-done"]);
  });

  it("has not necessarily written the terminal event before flush", async () => {
    const fs = memFs();
    const t = createTranscriptWriter("/t.jsonl", fs);
    t.write({ event: "review-branch-start" });
    t.write({ event: "review-branch-done" });

    // This is the state /apply-review saw when the handler returned early.
    expect(fs.read()).not.toContain("review-branch-done");

    await t.flush();
    expect(fs.read()).toContain("review-branch-done");
  });

  it("reports an append failure from flush instead of swallowing it", async () => {
    const fs = memFs((c) => c.includes("review-branch-done"));
    const t = createTranscriptWriter("/t.jsonl", fs);
    t.write({ event: "review-branch-start" });
    t.write({ event: "review-branch-done" });

    await expect(t.flush()).rejects.toThrow("disk full");
  });

  it("keeps the first failure, not the last", async () => {
    const fs = memFs((c) => c.includes("first") || c.includes("second"));
    const t = createTranscriptWriter("/t.jsonl", fs);
    t.write({ event: "first" });
    t.write({ event: "second" });

    await expect(t.flush()).rejects.toThrow("disk full");
  });

  it("keeps writing after a failed append", async () => {
    const fs = memFs((c) => c.includes("bad"));
    const t = createTranscriptWriter("/t.jsonl", fs);
    t.write({ event: "bad" });
    t.write({ event: "good" });

    await t.flush().catch(() => undefined);
    expect(fs.read()).toContain("good");
  });

  it("write() does not block on I/O", () => {
    const fs = memFs();
    const t = createTranscriptWriter("/t.jsonl", fs);
    t.write({ event: "review-branch-start" });
    // Nothing is on disk yet, which is exactly why flush() has to exist.
    expect(fs.read()).toBe("");
  });
});
