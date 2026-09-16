import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  applyEdits,
  findLatestTranscript,
  pruneTranscripts,
  type EditHost,
  type FsLike,
} from "../src/applyReview.js";

const WS = path.resolve("/ws");
const RUNS = path.resolve("/runs");
const r = (rel: string): string => path.resolve(WS, rel);
const runs = (rel: string): string => path.resolve(RUNS, rel);

type FakeFs = FsLike & { remove(p: string): Promise<void> };

function makeFakeFs(initial: {
  dirs?: Record<string, string[]>;
  files?: Record<string, string>;
  mtimes?: Record<string, number>;
}): { fs: FakeFs; files: Map<string, string> } {
  const dirs = new Map<string, string[]>(Object.entries(initial.dirs ?? {}));
  const files = new Map<string, string>(Object.entries(initial.files ?? {}));
  const mtimes = new Map<string, number>(Object.entries(initial.mtimes ?? {}));
  const fs: FakeFs = {
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
    async remove(p) {
      files.delete(p);
    },
  };
  return { fs, files };
}

const why = "w";

describe("applyEdits: replacement text is written literally", () => {
  // String.prototype.replace runs GetSubstitution on the replacement even for a
  // string search value, so `$&`, "$`", `$'` and `$$` used to be expanded.
  for (const newString of ["x$&y", "p$`q", "p$'q", "cost $$5", "a$1b"]) {
    it(`writes ${JSON.stringify(newString)} verbatim`, async () => {
      const { fs, files } = makeFakeFs({ files: { [r("a.txt")]: "AAA MARK ZZZ" } });
      const outcomes = await applyEdits(
        WS,
        [{ path: "a.txt", oldString: "MARK", newString, why }],
        fs,
        { dryRun: false },
      );
      expect(outcomes[0].status).toBe("written");
      expect(files.get(r("a.txt"))).toBe(`AAA ${newString} ZZZ`);
    });
  }

  it("is unchanged for replacements with no $ character", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: "before\nold\nafter" } });
    await applyEdits(WS, [{ path: "a.ts", oldString: "old", newString: "new", why }], fs, {
      dryRun: false,
    });
    expect(files.get(r("a.ts"))).toBe("before\nnew\nafter");
  });
});

describe("applyEdits: batch semantics", () => {
  it("commits the whole batch through the host in one call", async () => {
    const { fs } = makeFakeFs({
      files: { [r("a.ts")]: "one", [r("b.ts")]: "two" },
    });
    const commits: Array<Array<{ path: string; content: string }>> = [];
    const host: EditHost = {
      async commit(writes) {
        commits.push(writes);
      },
    };
    await applyEdits(
      WS,
      [
        { path: "a.ts", oldString: "one", newString: "1", why },
        { path: "b.ts", oldString: "two", newString: "2", why },
      ],
      fs,
      { dryRun: false, host },
    );
    expect(commits).toHaveLength(1);
    expect(commits[0]).toHaveLength(2);
  });

  it("lets a later edit see an earlier edit to the same file", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: "alpha beta" } });
    const outcomes = await applyEdits(
      WS,
      [
        { path: "a.ts", oldString: "alpha", newString: "ALPHA", why },
        { path: "a.ts", oldString: "beta", newString: "BETA", why },
      ],
      fs,
      { dryRun: false },
    );
    expect(outcomes.map((o) => o.status)).toEqual(["written", "written"]);
    expect(files.get(r("a.ts"))).toBe("ALPHA BETA");
  });

  it("reports host-committed edits as unsaved, not written", async () => {
    // The host mutates open documents; nothing reaches disk until the user
    // saves. Reporting these as written cost two round trips on 2026-09-16,
    // because `git status` stayed clean after a run that said "applied".
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: "one", [r("b.ts")]: "two" } });
    const host: EditHost = { async commit() {} };
    const outcomes = await applyEdits(
      WS,
      [
        { path: "a.ts", oldString: "one", newString: "1", why },
        { path: "b.ts", oldString: "two", newString: "2", why },
      ],
      fs,
      { dryRun: false, host },
    );
    expect(outcomes.map((o) => o.status)).toEqual(["unsaved", "unsaved"]);
    // The host swallowed the writes, so the backing files are untouched.
    expect(files.get(r("a.ts"))).toBe("one");
  });

  it("leaves a skipped edit skipped when a host is used", async () => {
    const { fs } = makeFakeFs({ files: { [r("a.ts")]: "keep" } });
    const host: EditHost = { async commit() {} };
    const outcomes = await applyEdits(
      WS,
      [
        { path: "a.ts", oldString: "keep", newString: "kept", why },
        { path: "a.ts", oldString: "absent", newString: "x", why },
      ],
      fs,
      { dryRun: false, host },
    );
    expect(outcomes.map((o) => o.status)).toEqual(["unsaved", "skipped"]);
  });

  it("writes nothing when a later edit fails to match", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: "keep" } });
    const host: EditHost = {
      async commit() {
        throw new Error("commit should not be reached in this test");
      },
    };
    const outcomes = await applyEdits(
      WS,
      [{ path: "a.ts", oldString: "absent", newString: "x", why }],
      fs,
      { dryRun: false, host },
    );
    expect(outcomes[0].status).toBe("skipped");
    expect(files.get(r("a.ts"))).toBe("keep");
  });

  it("dry run writes nothing and never commits", async () => {
    const { fs, files } = makeFakeFs({ files: { [r("a.ts")]: "old" } });
    let committed = false;
    const host: EditHost = {
      async commit() {
        committed = true;
      },
    };
    const outcomes = await applyEdits(
      WS,
      [{ path: "a.ts", oldString: "old", newString: "new", why }],
      fs,
      { dryRun: true, host },
    );
    expect(outcomes[0].status).toBe("dry-run");
    expect(committed).toBe(false);
    expect(files.get(r("a.ts"))).toBe("old");
  });
});

describe("findLatestTranscript: terminal-event detection", () => {
  it("ignores a transcript whose artifact merely quotes the event name", async () => {
    // A review of this codebase stores the event name inside a worker artifact.
    const quoting = JSON.stringify({
      event: "review-branch-iter",
      role: "worker",
      artifact: 'the handler writes {"event":"review-branch-done"} at the end',
    });
    const { fs } = makeFakeFs({
      dirs: { [RUNS]: ["quoting.jsonl"] },
      files: { [runs("quoting.jsonl")]: quoting + "\n" },
      mtimes: { [runs("quoting.jsonl")]: 10 },
    });
    expect(await findLatestTranscript(RUNS, fs)).toBeNull();
  });

  it("selects the newest genuinely completed transcript", async () => {
    const done = JSON.stringify({ event: "review-branch-done", approved: true });
    const { fs } = makeFakeFs({
      dirs: { [RUNS]: ["old.jsonl", "new.jsonl"] },
      files: {
        [runs("old.jsonl")]: done + "\n",
        [runs("new.jsonl")]: done + "\n",
      },
      mtimes: { [runs("old.jsonl")]: 1, [runs("new.jsonl")]: 2 },
    });
    expect(await findLatestTranscript(RUNS, fs)).toBe(runs("new.jsonl"));
  });
});

describe("pruneTranscripts", () => {
  it("keeps the newest N and deletes the rest with their apply logs", async () => {
    const { fs, files } = makeFakeFs({
      dirs: { [RUNS]: ["a.jsonl", "b.jsonl", "c.jsonl", "a-apply.json"] },
      files: {
        [runs("a.jsonl")]: "{}",
        [runs("b.jsonl")]: "{}",
        [runs("c.jsonl")]: "{}",
        [runs("a-apply.json")]: "{}",
      },
      mtimes: { [runs("a.jsonl")]: 1, [runs("b.jsonl")]: 2, [runs("c.jsonl")]: 3 },
    });
    const removed = await pruneTranscripts(RUNS, 2, fs);
    expect(files.has(runs("c.jsonl"))).toBe(true);
    expect(files.has(runs("b.jsonl"))).toBe(true);
    expect(files.has(runs("a.jsonl"))).toBe(false);
    expect(files.has(runs("a-apply.json"))).toBe(false);
    expect(removed).toHaveLength(2);
  });

  it("keeps everything when the limit is not exceeded", async () => {
    const { fs, files } = makeFakeFs({
      dirs: { [RUNS]: ["a.jsonl"] },
      files: { [runs("a.jsonl")]: "{}" },
      mtimes: { [runs("a.jsonl")]: 1 },
    });
    expect(await pruneTranscripts(RUNS, 5, fs)).toEqual([]);
    expect(files.has(runs("a.jsonl"))).toBe(true);
  });
});
