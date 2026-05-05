import { describe, it, expect } from "vitest";
import { filterPatchToScope, chunkPatch } from "../src/openspec/diff.js";

const SAMPLE = [
  "diff --git a/src/cli.ts b/src/cli.ts",
  "index 111..222 100644",
  "--- a/src/cli.ts",
  "+++ b/src/cli.ts",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
  "diff --git a/docs/readme.md b/docs/readme.md",
  "index 333..444 100644",
  "--- a/docs/readme.md",
  "+++ b/docs/readme.md",
  "@@ -1,1 +1,1 @@",
  "-foo",
  "+bar",
  "",
].join("\n");

describe("openspec/diff", () => {
  it("filterPatchToScope keeps only matching file blocks", () => {
    const out = filterPatchToScope(SAMPLE, ["src/"]);
    expect(out).toContain("src/cli.ts");
    expect(out).not.toContain("docs/readme.md");
  });

  it("filterPatchToScope matches exact paths", () => {
    const out = filterPatchToScope(SAMPLE, ["docs/readme.md"]);
    expect(out).toContain("docs/readme.md");
    expect(out).not.toContain("src/cli.ts");
  });

  it("filterPatchToScope returns empty when nothing matches", () => {
    const out = filterPatchToScope(SAMPLE, ["other/"]);
    expect(out).toBe("");
  });

  it("chunkPatch keeps small patches in one chunk", () => {
    const chunks = chunkPatch(SAMPLE, 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("src/cli.ts");
  });

  it("chunkPatch splits oversized single-file blocks into windows", () => {
    const big = ["diff --git a/big.txt b/big.txt", "@@"]
      .concat(Array.from({ length: 500 }, (_, i) => `+line ${i}`))
      .join("\n");
    const chunks = chunkPatch(big, 50); // ~200 char budget
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("chunkPatch packs multiple small blocks until the budget is hit", () => {
    const a = "diff --git a/a.ts b/a.ts\n+a\n";
    const b = "diff --git a/b.ts b/b.ts\n+b\n";
    const c = "diff --git a/c.ts b/c.ts\n+c\n";
    const chunks = chunkPatch(a + b + c, 1_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("a.ts");
    expect(chunks[0]).toContain("c.ts");
  });
});
