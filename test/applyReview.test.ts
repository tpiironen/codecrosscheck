import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  applyEdit,
  editsFrom,
  extractFixProposal,
  filterRejectedIssues,
  findLatestTranscript,
  issueFingerprint,
  renderFixProposal,
  resolveSafePath,
  runBuildGate,
  truncateMiddle,
  validateFixCoverage,
  type FsLike,
} from "../src/applyReview.js";
import { FixProposalSchema, type FixProposal } from "../src/schemas.js";

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

  it("returns the last structured proposal and last reviewer verdict", async () => {
    const p = path.resolve("/t.jsonl");
    const proposal = {
      summary: "one fix",
      fixes: [
        {
          findingId: 1,
          status: "fixed",
          explanation: "guarded the null case",
          edits: [{ path: "src/a.ts", oldString: "x", newString: "y", why: "guard" }],
        },
      ],
    };
    const lines = [
      `{"event":"review-branch-iter","iteration":1,"role":"reviewer","verdict":{"verdict":"revise","issues":[{"severity":"high","where":"a","why":"b","suggestion":"c"}]}}`,
      JSON.stringify({
        event: "review-branch-iter",
        iteration: 2,
        role: "worker",
        artifact: "## Summary\n\none fix",
        proposal,
      }),
      `{"event":"review-branch-iter","iteration":2,"role":"reviewer","verdict":{"verdict":"approve","issues":[]}}`,
      `{"event":"review-branch-done"}`,
    ];
    const { fs } = makeFakeFs({ files: { [p]: lines.join("\n") + "\n" } });
    const result = await extractFixProposal(p, fs);
    expect(result?.iteration).toBe(2);
    expect(result?.proposal?.fixes[0]?.edits[0]?.path).toBe("src/a.ts");
    expect(result?.verdict?.verdict).toBe("approve");
  });

  it("returns a null proposal for a legacy Markdown-only transcript", async () => {
    const p = path.resolve("/t.jsonl");
    const lines = [
      `{"event":"review-branch-iter","iteration":2,"role":"worker","artifact":"## Fix\\n// path: src/a.ts\\n"}`,
      `{"event":"review-branch-done"}`,
    ];
    const { fs } = makeFakeFs({ files: { [p]: lines.join("\n") + "\n" } });
    const result = await extractFixProposal(p, fs);
    expect(result).not.toBeNull();
    expect(result?.proposal).toBeNull();
    expect(result?.artifact).toContain("// path: src/a.ts");
  });

  it("ignores a stored proposal that does not validate", async () => {
    const p = path.resolve("/t.jsonl");
    const line = JSON.stringify({
      event: "review-branch-iter",
      iteration: 1,
      role: "worker",
      artifact: "text",
      proposal: { summary: "x", fixes: [{ findingId: 0, status: "nope" }] },
    });
    const { fs } = makeFakeFs({ files: { [p]: line + "\n" } });
    expect((await extractFixProposal(p, fs))?.proposal).toBeNull();
  });
});

describe("applyReview.editsFrom + renderFixProposal", () => {
  const proposal: FixProposal = {
    summary: "two findings",
    fixes: [
      {
        findingId: 1,
        status: "fixed",
        explanation: "added the guard",
        edits: [{ path: "src/a.ts", oldString: "old", newString: "new", why: "guard" }],
      },
      { findingId: 2, status: "disagree", explanation: "already handled at line 12", edits: [] },
    ],
  };

  it("flattens edits in proposal order", () => {
    expect(editsFrom(proposal).map((e) => e.path)).toEqual(["src/a.ts"]);
  });

  it("ignores edits attached to a non-fixed status", () => {
    // The schema refuses these, but a transcript written before that rule (or
    // hand-edited) must not apply an edit the UI presents as rebutted.
    const smuggled: FixProposal = {
      summary: "s",
      fixes: [
        {
          findingId: 1,
          status: "disagree",
          explanation: "reviewer is wrong",
          edits: [{ path: "src/evil.ts", oldString: "a", newString: "b", why: "w" }],
        },
        {
          findingId: 2,
          status: "unaddressed",
          explanation: "blocked",
          edits: [{ path: "src/also-evil.ts", oldString: "a", newString: "b", why: "w" }],
        },
      ],
    };
    expect(editsFrom(smuggled)).toEqual([]);
  });

  it("is rejected by the schema before it can be stored", () => {
    const result = FixProposalSchema.safeParse({
      summary: "s",
      fixes: [
        {
          findingId: 1,
          status: "disagree",
          explanation: "reviewer is wrong",
          edits: [{ path: "src/evil.ts", oldString: "a", newString: "b", why: "w" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("renders every fix, its status and its edits", () => {
    const md = renderFixProposal(proposal, [
      { severity: "high", where: "src/a.ts:1", why: "w", suggestion: "s" },
      { severity: "low", where: "src/b.ts:2", why: "w", suggestion: "s" },
    ]);
    expect(md).toContain("two findings");
    expect(md).toContain("Finding 1: src/a.ts:1 — Fixed");
    expect(md).toContain("Finding 2: src/b.ts:2 — Disagree");
    expect(md).toContain("already handled at line 12");
    expect(md).toContain("`src/a.ts` — guard");
  });
});

describe("applyReview.validateFixCoverage", () => {
  const fix = (findingId: number) => ({
    findingId,
    status: "fixed" as const,
    explanation: "e",
    edits: [],
  });

  it("accepts one entry per finding", () => {
    expect(validateFixCoverage({ summary: "s", fixes: [fix(1), fix(2)] }, 2)).toBeNull();
  });

  it("reports a finding with no entry", () => {
    const problem = validateFixCoverage({ summary: "s", fixes: [fix(1)] }, 3);
    expect(problem).toContain("no entry for finding(s) 2, 3");
  });

  it("reports a duplicated findingId", () => {
    const problem = validateFixCoverage({ summary: "s", fixes: [fix(1), fix(1)] }, 1);
    expect(problem).toContain("appears more than once");
  });

  it("reports an out-of-range findingId", () => {
    const problem = validateFixCoverage({ summary: "s", fixes: [fix(1), fix(7)] }, 2);
    expect(problem).toContain("outside 1..2");
  });
});

describe("applyReview.truncateMiddle", () => {
  it("returns short text unchanged", () => {
    expect(truncateMiddle("abc", 10)).toBe("abc");
  });

  it("keeps head and tail and marks the elision", () => {
    const text = "A".repeat(200) + "TAIL";
    const out = truncateMiddle(text, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("characters elided");
    expect(out.endsWith("TAIL")).toBe(true);
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

  it("reports an emptied issue list without asserting approval", () => {
    const v = {
      verdict: "revise" as const,
      issues: [issue("high", "src/a.ts:1", "issue A")],
    };
    const rejected = new Set([issueFingerprint(v.issues[0])]);
    const out = filterRejectedIssues(v, rejected);
    expect(out.dropped).toBe(1);
    expect(out.verdict.issues).toHaveLength(0);
    expect(out.emptiedBySuppression).toBe(true);
    // The reviewer never approved — suppression is not approval.
    expect(out.verdict.verdict).toBe("revise");
  });

  it("does not mutate the verdict it was given", () => {
    const v = {
      verdict: "revise" as const,
      issues: [issue("high", "src/a.ts:1", "issue A"), issue("low", "src/b.ts:2", "issue B")],
    };
    const out = filterRejectedIssues(v, new Set([issueFingerprint(v.issues[0])]));
    expect(v.issues).toHaveLength(2);
    expect(out.verdict).not.toBe(v);
    expect(out.emptiedBySuppression).toBe(false);
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

describe("applyReview.applyEdit — line-ending drift", () => {
  // Verbatim from the 2026-09-16 dogfood apply log
  // (.codecrosscheck/runs/2026-09-16T10-21-13-468Z-apply.json, edits[0]), where
  // 11 of 12 edits were skipped as "oldString not found". The model read a CRLF
  // file through read_file and emitted LF in its JSON anyway.
  const OLD_LF =
    '  edits: z\n    .array(ApplyEditSchema)\n    .describe("Exact edits that resolve the finding. MUST be empty unless status is `fixed`."),\n});';
  const NEW_LF =
    '  edits: z\n    .array(ApplyEditSchema)\n    .describe("Exact edits that resolve the finding. MUST be empty unless status is `fixed`."),\n})\n  .refine((f) => f.status === "fixed" || f.edits.length === 0);';
  const crlf = (s: string): string => s.replace(/\n/g, "\r\n");

  it("applies an LF oldString to the CRLF file it was read from", async () => {
    const fileBody = `const FixSchema = z.object({\r\n${crlf(OLD_LF)}\r\n`;
    const { fs, files } = makeFakeFs({ files: { [r("src/schemas.ts")]: fileBody } });

    const result = await applyEdit(
      WS,
      { path: "src/schemas.ts", oldString: OLD_LF, newString: NEW_LF, why: "finding 1" },
      fs,
      { dryRun: false },
    );

    expect(result.status).toBe("applied");
    const after = files.get(r("src/schemas.ts"))!;
    expect(after).toContain(".refine((f) => f.status === \"fixed\"");
    // The patched region must not smuggle LF into a CRLF file.
    expect(after.split("\n").every((l, i, a) => i === a.length - 1 || l.endsWith("\r"))).toBe(true);
  });

  it("applies a CRLF oldString to an LF file without rewriting the file's endings", async () => {
    const fileBody = `header\n${OLD_LF}\n`;
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: fileBody } });

    const result = await applyEdit(
      WS,
      { path: "a.ts", oldString: crlf(OLD_LF), newString: crlf(NEW_LF), why: "w" },
      fs,
      { dryRun: false },
    );

    expect(result.status).toBe("applied");
    expect(files.get(r("a.ts"))).not.toContain("\r");
  });

  it("still refuses an oldString that differs by more than line endings", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: crlf("alpha\nbeta\ngamma") } });
    const result = await applyEdit(
      WS,
      { path: "a.ts", oldString: "alpha\nBETA\ngamma", newString: "x", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("oldString not found");
    expect(files.get(r("a.ts"))).toBe(crlf("alpha\nbeta\ngamma"));
  });

  it("reports ambiguity found only in a normalised form", async () => {
    const { fs } = makeFakeFs({ files: { [r("a.ts")]: crlf("x\ny\nx\ny\n") } });
    const result = await applyEdit(
      WS,
      { path: "a.ts", oldString: "x\ny", newString: "z", why: "w" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("oldString matches 2 times");
  });
});

describe("applyReview.applyEdit — no repair guessing", () => {
  // Line endings are the only drift repaired. A diff-marked oldString is a
  // wrong edit, not a transport artefact.
  it("skips an oldString carrying unified-diff markers", async () => {
    const fileBody = [
      "    ModelAction ResolveAction(TIn input) => ModelAction.Upsert;",
      "    void Other();",
    ].join("\n");
    const { fs, files } = makeFakeFs({ files: { [r("a.cs")]: fileBody } });
    const oldStr = [
      "-    ModelAction ResolveAction(TIn input) => ModelAction.Upsert;",
      " ",
      "+    ModelAction? ResolveAction(TIn input) => null;",
    ].join("\n");

    const result = await applyEdit(
      WS,
      { path: "a.cs", oldString: oldStr, newString: oldStr, why: "diff-style" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("oldString not found");
    expect(files.get(r("a.cs"))).toBe(fileBody);
  });

  it("applies verbatim CRLF content against a CRLF file", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("a.cs")]: "alpha\r\nbeta\r\ngamma\r\n" } });
    const result = await applyEdit(
      WS,
      { path: "a.cs", oldString: "alpha\r\nbeta\r\n", newString: "ALPHA\r\nBETA\r\n", why: "verbatim" },
      fs,
      { dryRun: false },
    );
    expect(result.status).toBe("applied");
    expect(files.get(r("a.cs"))).toBe("ALPHA\r\nBETA\r\ngamma\r\n");
  });
});
