import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  applyEdit,
  buildFileInventory,
  composeApplyInput,
  extractFixProposal,
  filterRejectedIssues,
  findLatestTranscript,
  harvestPathsFromText,
  issueFingerprint,
  parseDisagreements,
  parseBlockedFindings,
  parseReferencedFiles,
  resolveSafePath,
  runBuildGate,
  stripDiffMarkers,
  type FsLike,
} from "../src/applyReview.js";

/**
 * Use a platform-correct workspace root so path.resolve produces matching keys
 * on both POSIX and Windows. On Windows /ws -> C:\ws once resolved; we mirror
 * that here.
 */
const WS = path.resolve("/ws");
const RUNS = path.resolve("/runs");
const r = (rel: string): string => path.resolve(WS, rel);
const runs = (rel: string): string => path.resolve(RUNS, rel);

/** In-memory FsLike for tests. Paths are normalised with forward-slash compare-friendly form. */
function makeFakeFs(initial: { dirs?: Record<string, string[]>; files?: Record<string, string>; mtimes?: Record<string, number> }): {
  fs: FsLike;
  files: Map<string, string>;
} {
  const dirs = new Map<string, string[]>(Object.entries(initial.dirs ?? {}));
  const files = new Map<string, string>(Object.entries(initial.files ?? {}));
  const mtimes = new Map<string, number>(Object.entries(initial.mtimes ?? {}));
  const fs: FsLike = {
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
    async writeFile(p, content) {
      files.set(p, content);
    },
    async exists(p) {
      return files.has(p) || dirs.has(p);
    },
  };
  return { fs, files };
}

describe("applyReview.findLatestTranscript", () => {
  it("returns null when directory does not exist", async () => {
    const { fs } = makeFakeFs({});
    expect(await findLatestTranscript(path.resolve("/nope"), fs)).toBeNull();
  });

  it("returns null when no transcripts contain a done event", async () => {
    const { fs } = makeFakeFs({
      dirs: { [RUNS]: ["a.jsonl"] },
      files: { [runs("a.jsonl")]: `{"event":"review-branch-iter"}\n` },
      mtimes: { [runs("a.jsonl")]: 1 },
    });
    expect(await findLatestTranscript(RUNS, fs)).toBeNull();
  });

  it("picks newest jsonl with a review-branch-done event", async () => {
    const { fs } = makeFakeFs({
      dirs: { [RUNS]: ["older.jsonl", "newer.jsonl", "skip.txt"] },
      files: {
        [runs("older.jsonl")]: `{"event":"review-branch-done"}\n`,
        [runs("newer.jsonl")]: `{"event":"review-branch-done"}\n`,
      },
      mtimes: { [runs("older.jsonl")]: 1, [runs("newer.jsonl")]: 2 },
    });
    const result = await findLatestTranscript(RUNS, fs);
    expect(result).toContain("newer.jsonl");
  });
});

describe("applyReview.extractFixProposal", () => {
  it("returns null when no worker iter exists", async () => {
    const p = path.resolve("/t.jsonl");
    const { fs } = makeFakeFs({
      files: { [p]: `{"event":"review-branch-iter","role":"reviewer","verdict":{"verdict":"revise","issues":[]}}\n` },
    });
    expect(await extractFixProposal(p, fs)).toBeNull();
  });

  it("returns last worker artifact and last reviewer verdict", async () => {
    const p = path.resolve("/t.jsonl");
    const lines = [
      `{"event":"review-branch-iter","iteration":1,"role":"reviewer","verdict":{"verdict":"revise","issues":[{"severity":"high","where":"a","why":"b","suggestion":"c"}]}}`,
      `{"event":"review-branch-iter","iteration":2,"role":"worker","artifact":"## Fix\\n// path: src/a.ts\\n"}`,
      `{"event":"review-branch-iter","iteration":2,"role":"reviewer","verdict":{"verdict":"approve","issues":[]}}`,
      `{"event":"review-branch-done"}`,
    ];
    const { fs } = makeFakeFs({ files: { [p]: lines.join("\n") + "\n" } });
    const result = await extractFixProposal(p, fs);
    expect(result?.iteration).toBe(2);
    expect(result?.proposal).toContain("// path: src/a.ts");
    expect(result?.verdict?.verdict).toBe("approve");
  });
});

describe("applyReview.parseReferencedFiles", () => {
  it("extracts unique paths from `// path:` directives", () => {
    const md = [
      "```ts",
      "// path: src/a.ts",
      "x",
      "```",
      "",
      "```cs",
      "// path: src/B.cs",
      "y",
      "```",
      "",
      "```ts",
      "// path: src/a.ts",
      "z",
      "```",
    ].join("\n");
    expect(parseReferencedFiles(md).sort()).toEqual(["src/B.cs", "src/a.ts"]);
  });

  it("strips trailing parenthetical annotations like (excerpt)", () => {
    const md = [
      "// path: src/a.cs (excerpt)",
      "// path: src/b.cs (new file)",
      "// path: src/c.cs",
    ].join("\n");
    expect(parseReferencedFiles(md).sort()).toEqual(["src/a.cs", "src/b.cs", "src/c.cs"]);
  });

  it("strips :line and :line-line suffixes", () => {
    const md = [
      "// path: src/a.cs:21",
      "// path: src/b.cs:10-20",
    ].join("\n");
    expect(parseReferencedFiles(md).sort()).toEqual(["src/a.cs", "src/b.cs"]);
  });

  it("returns empty when no directives present", () => {
    expect(parseReferencedFiles("nothing here")).toEqual([]);
  });
});

describe("applyReview.resolveSafePath", () => {
  it("rejects absolute paths", () => {
    const result = resolveSafePath(WS, path.resolve("/etc/passwd"));
    expect(result.ok).toBe(false);
  });

  it("rejects paths escaping the workspace", () => {
    const result = resolveSafePath(WS, "../outside.txt");
    expect(result.ok).toBe(false);
  });

  it("accepts a normal relative path", () => {
    const result = resolveSafePath(WS, "src/a.ts");
    expect(result.ok).toBe(true);
  });
});

describe("applyReview.applyEdit", () => {
  it("skips replace edit when file does not exist", async () => {
    const { fs } = makeFakeFs({});
    const result = await applyEdit(
      WS,
      { path: "src/a.ts", oldString: "x", newString: "y", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("file not found");
  });

  it("creates a new file when oldString is empty and file is missing", async () => {
    const { fs, files } = makeFakeFs({});
    const result = await applyEdit(
      WS,
      { path: "src/new.ts", oldString: "", newString: "hello", why: "new file" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("applied");
    expect(files.get(r("src/new.ts"))).toBe("hello");
  });

  it("refuses to overwrite an existing file via create mode", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("src/x.ts")]: "existing" } });
    const result = await applyEdit(
      WS,
      { path: "src/x.ts", oldString: "", newString: "new", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("already exists");
    expect(files.get(r("src/x.ts"))).toBe("existing");
  });

  it("skips when oldString missing", async () => {
    const { fs } = makeFakeFs({ files: { [r("src/a.ts")]: "hello" } });
    const result = await applyEdit(
      WS,
      { path: "src/a.ts", oldString: "missing", newString: "y", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("oldString not found");
  });

  it("skips when oldString matches multiple times", async () => {
    const { fs } = makeFakeFs({ files: { [r("src/a.ts")]: "x\nx\n" } });
    const result = await applyEdit(
      WS,
      { path: "src/a.ts", oldString: "x", newString: "y", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("matches");
  });

  it("rejects path escape", async () => {
    const { fs } = makeFakeFs({ files: { [r("x.ts")]: "a" } });
    const result = await applyEdit(
      WS,
      { path: "../etc/passwd", oldString: "a", newString: "b", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("path outside workspace");
  });

  it("applies when oldString matches exactly once", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("src/a.ts")]: "before\nold\nafter" } });
    const result = await applyEdit(
      WS,
      { path: "src/a.ts", oldString: "old", newString: "new", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("applied");
    expect(files.get(r("src/a.ts"))).toBe("before\nnew\nafter");
  });

  it("dry-run does not write", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: "old" } });
    const result = await applyEdit(
      WS,
      { path: "a.ts", oldString: "old", newString: "new", why: "w" },
      fs,
      { dryRun: true },
    );
    expect(result.status).toBe("dry-run");
    expect(files.get(r("a.ts"))).toBe("old");
  });
});

describe("applyReview.buildFileInventory", () => {
  it("includes existing files and annotates missing ones for creation", async () => {
    const { fs } = makeFakeFs({ files: { [r("a.ts")]: "AA" } });
    const result = await buildFileInventory(WS, ["a.ts", "b.ts"], fs);
    expect(result.inventory).toContain("AA");
    expect(result.inventory).toContain("b.ts (does not exist yet");
    expect(result.missing).toEqual([]);
  });

  it("reports unsafe paths in missing list", async () => {
    const { fs } = makeFakeFs({});
    const result = await buildFileInventory(WS, ["../oops"], fs);
    expect(result.missing[0]).toContain("path outside workspace");
  });

  it("resolves repo-prefixed paths by stripping leading segments", async () => {
    // Workspace contains src/a.ts; proposal supplies repo-prefixed path.
    const { fs } = makeFakeFs({ files: { [r("src/a.ts")]: "BODY" } });
    const result = await buildFileInventory(WS, ["repo/sub/src/a.ts"], fs);
    expect(result.inventory).toContain("BODY");
    expect(result.inventory).toContain("resolved path");
    expect(result.resolved.get("repo/sub/src/a.ts")).toBe("src/a.ts");
    expect(result.missing).toEqual([]);
  });
});

describe("applyReview.composeApplyInput", () => {
  it("includes proposal and inventory", () => {
    const out = composeApplyInput("PROPOSAL", "INV");
    expect(out).toContain("PROPOSAL");
    expect(out).toContain("INV");
  });
});

describe("applyReview.harvestPathsFromText", () => {
  it("extracts paths with recognised extensions", () => {
    const text = "Issue at Platform.Integration.Core/Function/BaseServiceBusFunction.cs:42 and src/foo.ts";
    const paths = harvestPathsFromText(text).sort();
    expect(paths).toEqual([
      "Platform.Integration.Core/Function/BaseServiceBusFunction.cs",
      "src/foo.ts",
    ]);
  });

  it("normalises backslashes and strips :line suffixes", () => {
    const paths = harvestPathsFromText("see Foo\\Bar\\Baz.cs:21-30");
    expect(paths).toEqual(["Foo/Bar/Baz.cs"]);
  });

  it("ignores URLs and absolute Windows paths", () => {
    const text = "https://example.com/foo.ts and C:/temp/bar.cs (skip both)";
    expect(harvestPathsFromText(text)).toEqual([]);
  });

  it("returns empty for prose without paths", () => {
    expect(harvestPathsFromText("just words, no files here")).toEqual([]);
  });
});

describe("applyReview.parseDisagreements", () => {
  it("extracts a single rebuttal from a fix proposal", () => {
    const md = [
      "## Fix proposal (round 2)",
      "",
      "### Issue 1: medium · src/foo.cs:10",
      "**Original finding:** something is wrong",
      "**Fix:** Disagree: the diff already handles this at line 12 via `EnsureValid`.",
      "",
      "**Justification:** see existing test `EnsureValid_HandlesNull`.",
      "",
      "### Issue 2: high · src/bar.cs:20",
      "**Original finding:** missing null check",
      "**Fix:** add `ArgumentNullException.ThrowIfNull(input)` at the top of `Process`.",
      "",
      "```cs",
      "// path: src/bar.cs",
      "...",
      "```",
    ].join("\n");
    const ds = parseDisagreements(md);
    expect(ds).toHaveLength(1);
    expect(ds[0].id).toBe(1);
    expect(ds[0].heading).toContain("Issue 1");
    expect(ds[0].rebuttal).toContain("EnsureValid");
  });

  it("returns empty when no disagreements present", () => {
    const md = "### Issue 1: low · a.cs:1\n**Fix:** add a comment\n";
    expect(parseDisagreements(md)).toEqual([]);
  });

  it("matches case-insensitively and tolerates whitespace", () => {
    const md = "### Issue 3: high · x.ts:5\n**Fix:**  disagree :  reviewer is wrong because Y\n";
    const ds = parseDisagreements(md);
    expect(ds).toHaveLength(1);
    expect(ds[0].id).toBe(3);
    expect(ds[0].rebuttal).toContain("reviewer is wrong");
  });
});

describe("applyReview.parseBlockedFindings", () => {
  it("flags 'Data I need' dodges as blocked", () => {
    const md = [
      "### Issue 1: medium · src/foo.cs:Execute",
      "**Original finding:** Cannot evaluate without source.",
      "**Fix:** I cannot produce the unified-diff hunk for `foo.cs` without the current source.",
      "",
      "**Data I need to produce the patch:**",
      "- Full current contents of foo.cs",
    ].join("\n");
    const blocked = parseBlockedFindings(md);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].id).toBe(1);
    expect(blocked[0].reason).toMatch(/source files|refuses|sketch|pending source/);
  });

  it("flags '(sketch \u2014 pending current source)' code blocks", () => {
    const md = [
      "### Issue 2: high · src/bar.cs:10",
      "**Fix:** Intended shape:",
      "",
      "```cs",
      "// path: src/bar.cs (sketch \u2014 pending current source)",
      "public class Bar {}",
      "```",
    ].join("\n");
    expect(parseBlockedFindings(md)).toHaveLength(1);
  });

  it("does not double-report findings already in parseDisagreements", () => {
    const md = [
      "### Issue 1: low · src/x.cs:1",
      "**Fix:** Disagree: I cannot produce a patch because the diff already handles this.",
    ].join("\n");
    expect(parseDisagreements(md)).toHaveLength(1);
    expect(parseBlockedFindings(md)).toEqual([]);
  });

  it("returns empty when the proposal is fully concrete", () => {
    const md = [
      "### Issue 1: high · src/y.cs:5",
      "**Fix:** Replace the call site:",
      "",
      "```cs",
      "// path: src/y.cs",
      "x.Foo();",
      "```",
    ].join("\n");
    expect(parseBlockedFindings(md)).toEqual([]);
  });
});

describe("applyReview.issueFingerprint + filterRejectedIssues", () => {
  const issue = (severity: "low" | "medium" | "high", where: string, why: string) => ({
    severity,
    where,
    why,
    suggestion: "anything",
  });

  it("fingerprints stable across whitespace and re-worded suggestions", () => {
    const a = issue("high", "src/a.ts:10", "raw SQL concat allows injection");
    const b = issue("high", "src/a.ts:10  ", " raw SQL concat allows injection ");
    expect(issueFingerprint(a)).toBe(issueFingerprint(b));
  });

  it("fingerprint differs when severity, where, or why differ", () => {
    const base = issue("high", "src/a.ts:10", "missing input validation");
    expect(issueFingerprint(base)).not.toBe(
      issueFingerprint(issue("medium", "src/a.ts:10", "missing input validation")),
    );
    expect(issueFingerprint(base)).not.toBe(
      issueFingerprint(issue("high", "src/a.ts:11", "missing input validation")),
    );
    expect(issueFingerprint(base)).not.toBe(
      issueFingerprint(issue("high", "src/a.ts:10", "missing auth check")),
    );
  });

  it("filterRejectedIssues drops matching issues and reports count", () => {
    const v = {
      verdict: "revise" as const,
      issues: [
        issue("high", "src/a.ts:1", "issue A"),
        issue("medium", "src/b.ts:2", "issue B"),
        issue("low", "src/c.ts:3", "issue C"),
      ],
    };
    const rejected = new Set([issueFingerprint(v.issues[0]), issueFingerprint(v.issues[2])]);
    const out = filterRejectedIssues(v, rejected);
    expect(out.dropped).toBe(2);
    expect(out.verdict.issues).toHaveLength(1);
    expect(out.verdict.issues[0].where).toBe("src/b.ts:2");
    expect(out.verdict.verdict).toBe("revise"); // not auto-approved; one issue remains
  });

  it("auto-approves when filtering empties the issue list", () => {
    const v = {
      verdict: "revise" as const,
      issues: [issue("high", "src/a.ts:1", "issue A")],
    };
    const rejected = new Set([issueFingerprint(v.issues[0])]);
    const out = filterRejectedIssues(v, rejected);
    expect(out.dropped).toBe(1);
    expect(out.verdict.issues).toHaveLength(0);
    expect(out.verdict.verdict).toBe("approve");
  });

  it("is a no-op when rejected set is empty", () => {
    const v = {
      verdict: "revise" as const,
      issues: [issue("high", "x:1", "y")],
    };
    const out = filterRejectedIssues(v, new Set());
    expect(out.dropped).toBe(0);
    expect(out.verdict).toBe(v); // returns the same object reference
  });
});

describe("applyReview.runBuildGate", () => {
  // Build a stub `runner` that mimics child_process.exec's signature.
  const stubRunner = (
    behaviour: "ok" | "fail" | "timeout",
    out: { stdout: string; stderr: string },
    exitCode = 1,
  ): Parameters<typeof runBuildGate>[0]["runner"] => {
    return (_command, _options, cb) => {
      // Defer one tick so durationMs is non-negative and resolve runs async.
      setImmediate(() => {
        if (behaviour === "ok") {
          cb(null, out.stdout, out.stderr);
          return;
        }
        if (behaviour === "fail") {
          const err = Object.assign(new Error("nonzero exit"), { code: exitCode });
          cb(err, out.stdout, out.stderr);
          return;
        }
        // timeout
        const err = Object.assign(new Error("timed out"), {
          killed: true,
          signal: "SIGTERM" as NodeJS.Signals,
        });
        cb(err, out.stdout, out.stderr);
      });
    };
  };

  it("returns exitCode 0 and full output on success", async () => {
    const result = await runBuildGate({
      cwd: "/anywhere",
      command: "echo hi",
      runner: stubRunner("ok", { stdout: "Build succeeded\n", stderr: "" }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("Build succeeded");
    expect(result.truncated).toBe(false);
  });

  it("returns the numeric exit code on non-zero exit and combines stdout+stderr", async () => {
    const result = await runBuildGate({
      cwd: "/anywhere",
      command: "false",
      runner: stubRunner("fail", { stdout: "out\n", stderr: "err\n" }, 1),
    });
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });

  it("flags timeout when the runner reports SIGTERM with killed=true", async () => {
    const result = await runBuildGate({
      cwd: "/anywhere",
      command: "sleep 99",
      timeoutMs: 10,
      runner: stubRunner("timeout", { stdout: "partial", stderr: "" }),
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(null);
  });

  it("truncates output longer than maxOutputBytes", async () => {
    const big = "x".repeat(2000);
    const result = await runBuildGate({
      cwd: "/anywhere",
      command: "echo big",
      maxOutputBytes: 100,
      runner: stubRunner("ok", { stdout: big, stderr: "" }),
    });
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBeLessThan(big.length);
    expect(result.output).toMatch(/truncated; \d+ more bytes/);
  });
});

describe("applyReview.stripDiffMarkers", () => {
  it("strips '-' and ' ' markers in old mode", () => {
    const diff = ["-removed", " context", "+added"].join("\n");
    expect(stripDiffMarkers(diff, "old")).toBe("removed\ncontext");
  });

  it("strips '+' and ' ' markers in new mode", () => {
    const diff = ["-removed", " context", "+added"].join("\n");
    expect(stripDiffMarkers(diff, "new")).toBe("context\nadded");
  });

  it("returns input unchanged when not diff-shaped", () => {
    const code = "function foo() {\n  return 1;\n}";
    expect(stripDiffMarkers(code, "old")).toBe(code);
  });

  it("returns input unchanged when no +/- markers present", () => {
    const code = " line1\n line2";
    expect(stripDiffMarkers(code, "old")).toBe(code);
  });
});

describe("applyReview.applyEdit diff-marker safety net", () => {
  it("recovers when worker pasted unified-diff lines into oldString/newString", async () => {
    const fileBody = [
      "    ModelAction ResolveAction(TIn input) => ModelAction.Upsert;",
      "    void Other();",
    ].join("\n");
    const { fs, files } = makeFakeFs({ files: { [r("a.cs")]: fileBody } });

    // Simulate a worker that pasted diff markers verbatim (the bug we hit).
    const oldStr = ["-    ModelAction ResolveAction(TIn input) => ModelAction.Upsert;", " ", "+    ModelAction? ResolveAction(TIn input) => null;"].join("\n");
    const newStr = oldStr; // both fields contain the same diff block

    const result = await applyEdit(
      WS,
      { path: "a.cs", oldString: oldStr, newString: newStr, why: "diff-style" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("applied");
    expect(files.get(r("a.cs"))).toContain("ModelAction? ResolveAction(TIn input) => null;");
    expect(files.get(r("a.cs"))).not.toContain("=> ModelAction.Upsert");
  });

  it("recovers from CRLF drift between worker output and file", async () => {
    const fileBody = "alpha\nbeta\ngamma";
    const { fs, files } = makeFakeFs({ files: { [r("a.cs")]: fileBody } });
    const result = await applyEdit(
      WS,
      { path: "a.cs", oldString: "alpha\r\nbeta\r\ngamma", newString: "ALPHA\r\nBETA\r\ngamma", why: "crlf" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("applied");
    expect(files.get(r("a.cs"))).toBe("ALPHA\nBETA\ngamma");
  });

  it("recovers when file is CRLF but worker emitted LF (common on Windows repos)", async () => {
    const fileBody = "alpha\r\nbeta\r\ngamma\r\n";
    const { fs, files } = makeFakeFs({ files: { [r("a.cs")]: fileBody } });
    const result = await applyEdit(
      WS,
      { path: "a.cs", oldString: "alpha\nbeta\ngamma", newString: "ALPHA\nBETA\ngamma", why: "lf-on-crlf" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("applied");
    // Replacement should have preserved CRLF inside the patched region.
    expect(files.get(r("a.cs"))).toBe("ALPHA\r\nBETA\r\ngamma\r\n");
  });
});
