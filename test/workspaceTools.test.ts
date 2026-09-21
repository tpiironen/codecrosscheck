import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  createWorkspaceToolset,
  denylistPolicy,
  repositoryIgnorePolicy,
  type IgnorePolicy,
  type ToolFs,
} from "../src/tools/workspaceTools.js";
import type { ToolCall } from "../src/clients/ChatClient.js";

const WS = path.resolve("/ws");
const r = (rel: string): string => path.resolve(WS, rel);

/** In-memory tree keyed by workspace-relative path with forward slashes. */
function makeFs(files: Record<string, string>): ToolFs {
  const abs = new Map(Object.entries(files).map(([rel, body]) => [r(rel), body]));
  const rels = Object.keys(files);
  return {
    async readFile(p) {
      const body = abs.get(p);
      if (body === undefined) throw new Error(`ENOENT: ${p}`);
      return body;
    },
    async readDir(p) {
      const prefix = path.relative(WS, p).replace(/\\/g, "/");
      const base = prefix === "" || prefix === "." ? "" : `${prefix}/`;
      const names = new Map<string, boolean>();
      for (const rel of rels) {
        if (!rel.startsWith(base)) continue;
        const rest = rel.slice(base.length);
        if (rest.length === 0) continue;
        const slash = rest.indexOf("/");
        names.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
      }
      if (names.size === 0 && base !== "") throw new Error(`ENOTDIR: ${p}`);
      return Array.from(names, ([name, isDirectory]) => ({ name, isDirectory }));
    },
    async exists(p) {
      if (abs.has(p)) return true;
      const prefix = path.relative(WS, p).replace(/\\/g, "/");
      return rels.some((rel) => rel.startsWith(`${prefix}/`));
    },
  };
}

const allowAll: IgnorePolicy = { async isIgnored() { return false; } };

function toolset(files: Record<string, string>, ignore: IgnorePolicy = allowAll) {
  return createWorkspaceToolset({ root: WS, fs: makeFs(files), ignore });
}

const call = (name: string, input: unknown): ToolCall => ({ callId: "c1", name, input });

describe("workspace toolset — exposure", () => {
  it("exposes exactly three read-only tools and no write operation", () => {
    const names = toolset({}).specs.map((s) => s.name).sort();
    expect(names).toEqual(["list_directory", "read_file", "search_workspace"]);
    expect(names.join(" ")).not.toMatch(/write|create|delete|move|rename|exec|run/i);
  });

  it("declares a JSON Schema for every tool input", () => {
    for (const spec of toolset({}).specs) {
      expect(spec.inputSchema.type).toBe("object");
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown tool name", async () => {
    const result = await toolset({}).invoke(call("write_file", { path: "a", content: "x" }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });
});

describe("workspace toolset — read_file", () => {
  it("returns the file contents", async () => {
    const result = await toolset({ "src/a.ts": "export const x = 1;" }).invoke(
      call("read_file", { path: "src/a.ts" }),
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("export const x = 1;");
  });

  it("refuses a path that escapes the workspace root, with a reason", async () => {
    const result = await toolset({ "a.ts": "x" }).invoke(call("read_file", { path: "../../etc/passwd" }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("path outside workspace");
  });

  it("refuses an absolute path", async () => {
    const result = await toolset({ "a.ts": "x" }).invoke(
      call("read_file", { path: path.resolve("/etc/passwd") }),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("refused");
  });

  it("refuses an ignored path and returns no content", async () => {
    const files = { ".env": "SECRET=hunter2" };
    const result = await toolset(files, denylistPolicy()).invoke(call("read_file", { path: ".env" }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("ignore rules");
    expect(result.content).not.toContain("hunter2");
  });

  it("returns a line range when asked", async () => {
    const body = ["one", "two", "three", "four"].join("\n");
    const result = await toolset({ "a.ts": body }).invoke(
      call("read_file", { path: "a.ts", startLine: 2, endLine: 3 }),
    );
    expect(result.content).toContain("lines 2-3 of 4");
    expect(result.content).toContain("two\nthree");
    expect(result.content).not.toContain("four");
  });

  it("truncates an oversized file and says so", async () => {
    const files = { "big.ts": "HEAD" + "a".repeat(5_000) + "TAIL" };
    const ts = createWorkspaceToolset({ root: WS, fs: makeFs(files), ignore: allowAll, maxFileChars: 500 });
    const result = await ts.invoke(call("read_file", { path: "big.ts" }));
    expect(result.content).toContain("truncated");
    expect(result.content).toContain("HEAD");
    expect(result.content).toContain("TAIL");
  });

  it("reports a missing file rather than inventing one", async () => {
    const result = await toolset({ "a.ts": "x" }).invoke(call("read_file", { path: "b.ts" }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("not found");
  });

  it("refuses a binary file", async () => {
    const result = await toolset({ "a.bin": "PK\u0000\u0003" }).invoke(call("read_file", { path: "a.bin" }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("binary");
  });

  it("returns a correctable error for invalid arguments", async () => {
    const result = await toolset({ "a.ts": "x" }).invoke(call("read_file", { file: "a.ts" }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("invalid input");
  });
});

describe("workspace toolset — search_workspace", () => {
  const tree = {
    "src/a.ts": "export function target(): void {}\nconst other = 1;",
    "src/b.ts": "import { target } from './a.js';",
    "docs/readme.md": "nothing here",
  };

  it("finds a symbol across files with path and line", async () => {
    const result = await toolset(tree).invoke(call("search_workspace", { query: "target" }));
    expect(result.content).toContain("src/a.ts:1");
    expect(result.content).toContain("src/b.ts:1");
    expect(result.content).not.toContain("docs/readme.md");
  });

  it("supports a regular expression", async () => {
    const result = await toolset(tree).invoke(
      call("search_workspace", { query: "^export function \\w+", isRegexp: true }),
    );
    expect(result.content).toContain("src/a.ts:1");
  });

  it("reports an invalid regular expression instead of throwing", async () => {
    const result = await toolset(tree).invoke(call("search_workspace", { query: "([", isRegexp: true }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("invalid regular expression");
  });

  it("narrows by path substring", async () => {
    const result = await toolset(tree).invoke(
      call("search_workspace", { query: "target", pathContains: "b.ts" }),
    );
    expect(result.content).toContain("src/b.ts");
    expect(result.content).not.toContain("src/a.ts");
  });

  it("never reads an ignored file", async () => {
    // Search for the key name, not the secret: a no-match message echoes the
    // query, so querying the secret itself could not prove it stayed unread.
    const files = { "src/a.ts": "const k = 1;", ".env": "API_KEY=leakme" };
    const result = await toolset(files, denylistPolicy()).invoke(call("search_workspace", { query: "API_KEY" }));
    expect(result.content).not.toContain("leakme");
    expect(result.content).toContain("No matches");
  });

  it("says so when nothing matches", async () => {
    const result = await toolset(tree).invoke(call("search_workspace", { query: "zzz-not-present" }));
    expect(result.content).toContain("No matches");
  });

  it("stops at the invocation deadline and says the result is partial", async () => {
    const result = await toolset(tree).invoke(call("search_workspace", { query: "target" }), {
      deadlineAt: Date.now() - 1,
    });
    expect(result.content).toContain("time budget");
    expect(result.content).not.toContain("src/a.ts:1");
  });

  it("counts every walked file against the cap, not only the ones it opens", async () => {
    // `pathContains` skips a file before it is read; counting only reads let a
    // narrowed search walk an entire repository without ever hitting the cap.
    const files: Record<string, string> = { "aaa/1.ts": "x", "aaa/2.ts": "x", "aaa/3.ts": "x" };
    files["src/hit.ts"] = "needle";
    const ts = createWorkspaceToolset({ root: WS, fs: makeFs(files), ignore: allowAll, maxFilesScanned: 2 });

    const result = await ts.invoke(call("search_workspace", { query: "needle", pathContains: "src/" }));

    expect(result.content).toContain("stopped after walking 2 file(s)");
    expect(result.content).not.toContain("src/hit.ts");
  });

  it("asks the ignore policy once per depth level, not once per entry", async () => {
    const batches: number[] = [];
    const policy: IgnorePolicy = {
      async isIgnored() {
        throw new Error("per-entry check used when a batch was available");
      },
      async filterIgnored(rels) {
        batches.push(rels.length);
        return new Set<string>();
      },
    };
    const files = { "src/a.ts": "needle", "src/b.ts": "x", "docs/c.md": "y", "top.txt": "z" };

    await createWorkspaceToolset({ root: WS, fs: makeFs(files), ignore: policy }).invoke(
      call("search_workspace", { query: "needle" }),
    );

    // Level 0: src/, docs/, top.txt. Level 1: src's two files plus docs' one.
    expect(batches).toEqual([3, 3]);
  });
});

describe("workspace toolset — list_directory", () => {
  const tree = { "src/a.ts": "x", "src/nested/b.ts": "y", "README.md": "z" };

  it("lists the root when no path is given", async () => {
    const result = await toolset(tree).invoke(call("list_directory", {}));
    expect(result.content).toContain("README.md");
    expect(result.content).toContain("src/");
  });

  it("marks directories with a trailing slash", async () => {
    const result = await toolset(tree).invoke(call("list_directory", { path: "src" }));
    expect(result.content).toContain("nested/");
    expect(result.content).toContain("a.ts");
  });

  it("omits ignored entries", async () => {
    const files = { "src/a.ts": "x", "node_modules/pkg/index.js": "y" };
    const result = await toolset(files, denylistPolicy()).invoke(call("list_directory", {}));
    expect(result.content).not.toContain("node_modules");
  });

  it("refuses a path outside the root", async () => {
    const result = await toolset(tree).invoke(call("list_directory", { path: "../.." }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain("refused");
  });
});

describe("denylistPolicy", () => {
  it("blocks version-control, build output and dependency trees", async () => {
    const policy = denylistPolicy();
    for (const p of [".git/config", "node_modules/x/index.js", "dist/bundle.js", "src/obj/Debug/a.dll"]) {
      expect(await policy.isIgnored(p), p).toBe(true);
    }
  });

  it("blocks credential files wherever they sit", async () => {
    const policy = denylistPolicy();
    for (const p of [".env", "config/.env.local", "certs/server.pem", "deploy/id_rsa", "app.secrets.json"]) {
      expect(await policy.isIgnored(p), p).toBe(true);
    }
  });

  it("allows ordinary source", async () => {
    const policy = denylistPolicy();
    for (const p of ["src/extension.ts", "test/a.test.ts", "README.md", "package.json"]) {
      expect(await policy.isIgnored(p), p).toBe(false);
    }
  });
});

describe("repositoryIgnorePolicy", () => {
  it("consults git for paths the denylist allows", async () => {
    const asked: string[] = [];
    const policy = repositoryIgnorePolicy(WS, async (_root, rels) => {
      asked.push(...rels);
      return new Set(rels.filter((r) => r === "generated/out.ts"));
    });
    expect(await policy.isIgnored("generated/out.ts")).toBe(true);
    expect(await policy.isIgnored("src/a.ts")).toBe(false);
    expect(asked).toEqual(["generated/out.ts", "src/a.ts"]);
  });

  it("does not consult git for a denylisted path", async () => {
    const asked: string[] = [];
    const policy = repositoryIgnorePolicy(WS, async (_root, rels) => {
      asked.push(...rels);
      return new Set<string>();
    });
    expect(await policy.isIgnored(".env")).toBe(true);
    expect(asked).toEqual([]);
  });

  it("caches the answer per path", async () => {
    let calls = 0;
    const policy = repositoryIgnorePolicy(WS, async () => {
      calls++;
      return new Set<string>();
    });
    await policy.isIgnored("src/a.ts");
    await policy.isIgnored("src/a.ts");
    expect(calls).toBe(1);
  });

  it("answers a whole listing in one git call", async () => {
    let calls = 0;
    const policy = repositoryIgnorePolicy(WS, async (_root, rels) => {
      calls++;
      return new Set(rels.filter((r) => r.endsWith(".log")));
    });
    const ignored = await policy.filterIgnored!(["src/a.ts", "out.log", "node_modules", "src/b.ts"]);
    expect(calls).toBe(1);
    expect(Array.from(ignored).sort()).toEqual(["node_modules", "out.log"]);
  });

  it("does not re-ask git for a path already answered in a batch", async () => {
    const asked: string[][] = [];
    const policy = repositoryIgnorePolicy(WS, async (_root, rels) => {
      asked.push([...rels]);
      return new Set<string>();
    });
    await policy.filterIgnored!(["src/a.ts", "src/b.ts"]);
    await policy.filterIgnored!(["src/b.ts", "src/c.ts"]);
    expect(asked).toEqual([["src/a.ts", "src/b.ts"], ["src/c.ts"]]);
  });

  it("falls back to the denylist when git cannot answer, and stops asking", async () => {
    let calls = 0;
    const policy = repositoryIgnorePolicy(WS, async () => {
      calls++;
      throw new Error("not a git repository");
    });
    expect(await policy.isIgnored("src/a.ts")).toBe(false);
    expect(await policy.isIgnored("src/b.ts")).toBe(false);
    expect(calls).toBe(1);
    expect(await policy.isIgnored(".git/config")).toBe(true);
  });
});
