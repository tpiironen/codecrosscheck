import { describe, it, expect } from "vitest";
import { filterPatchToScope, chunkPatch, countPatchFiles, patchPaths, scopePatchToPaths } from "../src/openspec/diff.js";

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

  it("patchPaths lists every changed file in patch order", () => {
    expect(patchPaths(SAMPLE)).toEqual(["src/cli.ts", "docs/readme.md"]);
  });

  it("patchPaths takes the post-image path of a rename", () => {
    const renamed = "diff --git a/src/old.ts b/src/new.ts\nsimilarity index 95%\nrename from src/old.ts\nrename to src/new.ts\n";
    expect(patchPaths(renamed)).toEqual(["src/new.ts"]);
  });

  it("patchPaths returns nothing for an empty patch", () => {
    expect(patchPaths("")).toEqual([]);
  });

  it("patchPaths names a mode-only change whose path contains a space", () => {
    const modeOnly = [
      "diff --git a/src/my file.ts b/src/my file.ts",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n");
    expect(patchPaths(modeOnly)).toEqual(["src/my file.ts"]);
  });

  it("patchPaths decodes a C-quoted path in a mode-only header", () => {
    const modeOnly = [
      'diff --git "a/src/caf\\303\\251 log.ts" "b/src/caf\\303\\251 log.ts"',
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n");
    expect(patchPaths(modeOnly)).toEqual(["src/caf\u00e9 log.ts"]);
  });

  it("patchPaths handles a path containing a space", () => {
    const spaced = [
      "diff --git a/src/my file.ts b/src/my file.ts",
      "index 111..222 100644",
      "--- a/src/my file.ts",
      "+++ b/src/my file.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    expect(patchPaths(spaced)).toEqual(["src/my file.ts"]);
  });

  it("patchPaths decodes a C-quoted path", () => {
    const quoted = [
      'diff --git "a/src/caf\\303\\251 log.ts" "b/src/caf\\303\\251 log.ts"',
      "index 111..222 100644",
      '--- "a/src/caf\\303\\251 log.ts"',
      '+++ "b/src/caf\\303\\251 log.ts"',
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    expect(patchPaths(quoted)).toEqual(["src/caf\u00e9 log.ts"]);
  });

  it("patchPaths names a deleted file with a quoted, spaced path", () => {
    const deleted = [
      'diff --git "a/src/old file.ts" "b/src/old file.ts"',
      "deleted file mode 100644",
      "index 111..0000000",
      '--- "a/src/old file.ts"',
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-gone",
      "",
    ].join("\n");
    expect(patchPaths(deleted)).toEqual(["src/old file.ts"]);
  });

  it("filterPatchToScope keeps a deleted spaced path when its directory is in scope", () => {
    const deleted = [
      'diff --git "a/src/old file.ts" "b/src/old file.ts"',
      "deleted file mode 100644",
      '--- "a/src/old file.ts"',
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-gone",
      "",
    ].join("\n");
    expect(filterPatchToScope(deleted, ["src/"])).toContain("old file.ts");
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
