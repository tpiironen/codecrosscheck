import { describe, it, expect } from "vitest";
import { filterPatchToScope, chunkPatch, countPatchFiles, scopePatchToPaths } from "../src/openspec/diff.js";

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

describe("scopePatchToPaths — re-review context scoping", () => {
  const THREE = [
    "diff --git a/src/a.ts b/src/a.ts\n@@\n+a\n",
    "diff --git a/src/b.ts b/src/b.ts\n@@\n+b\n",
    "diff --git a/docs/c.md b/docs/c.md\n@@\n+c\n",
  ].join("");

  it("counts per-file blocks", () => {
    expect(countPatchFiles(THREE)).toBe(3);
    expect(countPatchFiles("")).toBe(0);
  });

  it("keeps only cited files and reports the omitted count", () => {
    const r = scopePatchToPaths(THREE, ["src/a.ts"]);
    expect(r.scoped).toBe(true);
    expect(r.included).toBe(1);
    expect(r.omitted).toBe(2);
    expect(r.patch).toContain("src/a.ts");
    expect(r.patch).not.toContain("src/b.ts");
    expect(r.patch).not.toContain("docs/c.md");
  });

  it("falls back to the full patch when no cited path matches", () => {
    const r = scopePatchToPaths(THREE, ["src/nowhere.ts"]);
    expect(r.scoped).toBe(false);
    expect(r.patch).toBe(THREE);
    expect(r.included).toBe(3);
    expect(r.omitted).toBe(0);
  });

  it("falls back to the full patch when no paths are cited", () => {
    const r = scopePatchToPaths(THREE, []);
    expect(r.scoped).toBe(false);
    expect(r.patch).toBe(THREE);
    expect(r.omitted).toBe(0);
  });

  it("never reports omissions it cannot substantiate", () => {
    // A fallback must not claim files were dropped — that would tell the
    // reviewer the branch is larger than what it was shown.
    for (const paths of [[], ["src/nowhere.ts"]]) {
      expect(scopePatchToPaths(THREE, paths).omitted).toBe(0);
    }
  });

  it("scopes to a directory prefix", () => {
    const r = scopePatchToPaths(THREE, ["src"]);
    expect(r.included).toBe(2);
    expect(r.omitted).toBe(1);
    expect(r.patch).not.toContain("docs/c.md");
  });
});
