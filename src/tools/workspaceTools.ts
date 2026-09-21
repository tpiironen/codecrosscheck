import * as path from "node:path";
import { z } from "zod";
import { resolveSafePath, truncateMiddle } from "../applyReview.js";
import { toProviderJsonSchema } from "../clients/schemaText.js";
import type { ToolCall, ToolInvocation, ToolResult, ToolSpec } from "../clients/ChatClient.js";

/**
 * A read-only workspace toolset offered to worker and reviewer agents.
 *
 * It exists so an agent can fetch the file it turns out to need *while
 * reasoning*, which no pre-computed harvesting pass can predict. Everything
 * here is deliberately read-only: there is no operation that creates, modifies
 * or deletes a file, so granting it to a model cannot change the tree.
 */

export interface ToolFs {
  readFile(abs: string): Promise<string>;
  readDir(abs: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  exists(abs: string): Promise<boolean>;
}

export interface IgnorePolicy {
  /** `rel` is workspace-relative with forward slashes. */
  isIgnored(rel: string): Promise<boolean>;
  /**
   * Answer for a whole directory listing at once, returning the ignored subset.
   * A policy that shells out to git MUST implement this: one process per path
   * makes a tree walk cost minutes.
   */
  filterIgnored?(rels: readonly string[]): Promise<Set<string>>;
}

export interface WorkspaceToolsetOptions {
  root: string;
  fs: ToolFs;
  ignore: IgnorePolicy;
  /** Cap on the characters returned by one `read_file` call. */
  maxFileChars?: number;
  /** Cap on the matches returned by one `search_workspace` call. */
  maxMatches?: number;
  /** Cap on the files one `search_workspace` call will open. */
  maxFilesScanned?: number;
}

export interface WorkspaceToolset {
  specs: ToolSpec[];
  invoke(call: ToolCall, ctx?: ToolInvocation): Promise<ToolResult>;
}

const DEFAULT_MAX_FILE_CHARS = 60_000;
const DEFAULT_MAX_MATCHES = 60;
const DEFAULT_MAX_FILES_SCANNED = 2_000;

/** Files this size or larger are treated as data, not source, and skipped by search. */
const SEARCH_FILE_SIZE_LIMIT = 1_000_000;

const ReadFileInput = z.object({
  path: z.string().min(1).describe("Workspace-relative path, e.g. `src/extension.ts`."),
  startLine: z.number().int().min(1).optional().describe("1-based first line to return. Omit for the whole file."),
  endLine: z.number().int().min(1).optional().describe("1-based last line, inclusive."),
});

const SearchInput = z.object({
  query: z.string().min(1).describe("Text to find, or a regular expression when `isRegexp` is true."),
  isRegexp: z.boolean().optional().describe("Treat `query` as a JavaScript regular expression. Default false."),
  pathContains: z
    .string()
    .optional()
    .describe("Only search files whose workspace-relative path contains this substring."),
  maxResults: z.number().int().min(1).max(200).optional().describe("Cap on matches returned."),
});

const ListDirectoryInput = z.object({
  path: z.string().optional().describe("Workspace-relative directory. Omit or use `.` for the workspace root."),
});

export function createWorkspaceToolset(opts: WorkspaceToolsetOptions): WorkspaceToolset {
  const maxFileChars = opts.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
  const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
  const maxFilesScanned = opts.maxFilesScanned ?? DEFAULT_MAX_FILES_SCANNED;

  const specs: ToolSpec[] = [
    {
      name: "read_file",
      description:
        "Read a text file from the workspace. Use this whenever a judgement depends on code you " +
        "have not been shown; never guess at a file's contents.",
      inputSchema: toProviderJsonSchema(ReadFileInput, "read_file"),
    },
    {
      name: "search_workspace",
      description:
        "Find where a symbol, string or pattern occurs across the workspace. Returns " +
        "`path:line: text` for each match. Use this to locate a definition before reading a file.",
      inputSchema: toProviderJsonSchema(SearchInput, "search_workspace"),
    },
    {
      name: "list_directory",
      description: "List the entries of a workspace directory. Directories are suffixed with `/`.",
      inputSchema: toProviderJsonSchema(ListDirectoryInput, "list_directory"),
    },
  ];

  /** Shared gate: normalise, confine to the root, apply ignore rules, confirm existence. */
  async function admit(candidate: string): Promise<{ ok: true; rel: string; abs: string } | { ok: false; reason: string }> {
    const rel = candidate.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (rel.length === 0) return { ok: false, reason: "empty path" };
    const safe = resolveSafePath(opts.root, rel);
    if (!safe.ok) {
      return { ok: false, reason: `refused: ${safe.reason} (paths must stay inside the workspace root)` };
    }
    if (await opts.ignore.isIgnored(rel)) {
      return { ok: false, reason: "refused: path is excluded by the repository's ignore rules" };
    }
    if (!(await opts.fs.exists(safe.abs))) {
      return { ok: false, reason: "not found in the workspace" };
    }
    return { ok: true, rel, abs: safe.abs };
  }

  async function readFile(input: z.infer<typeof ReadFileInput>): Promise<ToolResult> {
    const gate = await admit(input.path);
    if (!gate.ok) return { content: `${input.path}: ${gate.reason}`, isError: true };

    let content: string;
    try {
      content = await opts.fs.readFile(gate.abs);
    } catch (err) {
      return { content: `${gate.rel}: unreadable (${(err as Error).message})`, isError: true };
    }
    if (content.includes("\u0000")) {
      return { content: `${gate.rel}: binary file, not readable as text`, isError: true };
    }

    let header = gate.rel;
    if (input.startLine !== undefined || input.endLine !== undefined) {
      const lines = content.split("\n");
      const from = Math.max(1, input.startLine ?? 1);
      const to = Math.min(lines.length, input.endLine ?? lines.length);
      if (from > lines.length) {
        return { content: `${gate.rel}: has only ${lines.length} lines`, isError: true };
      }
      content = lines.slice(from - 1, to).join("\n");
      header = `${gate.rel} (lines ${from}-${to} of ${lines.length})`;
    }

    const body = truncateMiddle(content, maxFileChars);
    if (body.length < content.length) {
      header += ` (truncated to ${maxFileChars.toLocaleString("en-US")} chars — request a line range for the rest)`;
    }
    return { content: `${header}\n\n${body}` };
  }

  async function search(
    input: z.infer<typeof SearchInput>,
    ctx: ToolInvocation | undefined,
  ): Promise<ToolResult> {
    let matcher: (line: string) => boolean;
    if (input.isRegexp) {
      let re: RegExp;
      try {
        re = new RegExp(input.query);
      } catch (err) {
        return { content: `invalid regular expression: ${(err as Error).message}`, isError: true };
      }
      matcher = (line) => re.test(line);
    } else {
      const needle = input.query.toLowerCase();
      matcher = (line) => line.toLowerCase().includes(needle);
    }

    const limit = Math.min(input.maxResults ?? maxMatches, maxMatches);
    const hits: string[] = [];
    // `visited` bounds the walk; `scanned` reports the files actually opened.
    // Counting only the opened ones let a `pathContains` search walk forever.
    let visited = 0;
    let scanned = 0;
    let stop: "matches" | "files" | "time" | null = null;

    for await (const rel of walk(opts, "")) {
      if (hits.length >= limit) {
        stop = "matches";
        break;
      }
      if (visited >= maxFilesScanned) {
        stop = "files";
        break;
      }
      if (ctx && Date.now() >= ctx.deadlineAt) {
        stop = "time";
        break;
      }
      visited++;
      if (input.pathContains && !rel.includes(input.pathContains)) continue;
      const abs = path.resolve(opts.root, rel);
      let content: string;
      try {
        content = await opts.fs.readFile(abs);
      } catch {
        continue;
      }
      if (content.length > SEARCH_FILE_SIZE_LIMIT || content.includes("\u0000")) continue;
      scanned++;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!matcher(line)) continue;
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
        if (hits.length >= limit) {
          stop = "matches";
          break;
        }
      }
    }

    const note =
      stop === "matches"
        ? `\n\n(stopped at ${hits.length} match(es); narrow the query or set pathContains)`
        : stop === "files"
          ? `\n\n(stopped after walking ${visited} file(s); narrow the search with pathContains)`
          : stop === "time"
            ? `\n\n(stopped early: the time budget for this call ran out after ${visited} file(s) — ` +
              `results are partial, narrow the search with pathContains)`
            : "";

    if (hits.length === 0) {
      return { content: `No matches for ${JSON.stringify(input.query)} in ${scanned} file(s) searched.${note}` };
    }
    return { content: `${hits.length} match(es):\n\n${hits.join("\n")}${note}` };
  }

  async function listDirectory(input: z.infer<typeof ListDirectoryInput>): Promise<ToolResult> {
    const requested = input.path && input.path !== "." ? input.path : "";
    let dirAbs = path.resolve(opts.root);
    let label = ".";
    if (requested) {
      const gate = await admit(requested);
      if (!gate.ok) return { content: `${requested}: ${gate.reason}`, isError: true };
      dirAbs = gate.abs;
      label = gate.rel;
    }
    let entries: Array<{ name: string; isDirectory: boolean }>;
    try {
      entries = await opts.fs.readDir(dirAbs);
    } catch (err) {
      return { content: `${label}: not a readable directory (${(err as Error).message})`, isError: true };
    }
    const allowed = await admitEntries(
      opts.ignore,
      entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ ...e, rel: requested ? `${label}/${e.name}` : e.name })),
    );
    const kept = allowed.map((e) => (e.isDirectory ? `${e.name}/` : e.name));
    return {
      content: kept.length > 0 ? `${label}\n\n${kept.join("\n")}` : `${label}\n\n(empty, or every entry is ignored)`,
    };
  }

  return {
    specs,
    async invoke(call: ToolCall, ctx?: ToolInvocation): Promise<ToolResult> {
      switch (call.name) {
        case "read_file": {
          const parsed = ReadFileInput.safeParse(call.input);
          if (!parsed.success) return inputError(call, parsed.error);
          return readFile(parsed.data);
        }
        case "search_workspace": {
          const parsed = SearchInput.safeParse(call.input);
          if (!parsed.success) return inputError(call, parsed.error);
          return search(parsed.data, ctx);
        }
        case "list_directory": {
          const parsed = ListDirectoryInput.safeParse(call.input);
          if (!parsed.success) return inputError(call, parsed.error);
          return listDirectory(parsed.data);
        }
        default:
          return {
            content: `Unknown tool ${JSON.stringify(call.name)}. Available: read_file, search_workspace, list_directory.`,
            isError: true,
          };
      }
    },
  };
}

function inputError(call: ToolCall, error: z.ZodError): ToolResult {
  const detail = error.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
  return { content: `${call.name}: invalid input — ${detail}. Fix the arguments and call again.`, isError: true };
}

/**
 * Yield every non-ignored file under the root, one depth level at a time.
 *
 * Breadth-first rather than depth-first so a whole level's entries can be
 * admitted in a single ignore query: a git-backed policy costs one process per
 * query, and this repository alone has ~130 directories against ~8 levels.
 */
async function* walk(opts: WorkspaceToolsetOptions, start: string): AsyncGenerator<string> {
  let level = [start];
  while (level.length > 0) {
    const entries: Array<{ name: string; isDirectory: boolean; rel: string }> = [];
    for (const dir of level) {
      const abs = dir ? path.resolve(opts.root, dir) : path.resolve(opts.root);
      try {
        for (const e of await opts.fs.readDir(abs)) {
          entries.push({ ...e, rel: dir ? `${dir}/${e.name}` : e.name });
        }
      } catch {
        continue;
      }
    }
    const allowed = await admitEntries(opts.ignore, entries);
    const next: string[] = [];
    for (const entry of allowed) {
      if (entry.isDirectory) next.push(entry.rel);
      else yield entry.rel;
    }
    level = next;
  }
}

/**
 * Drop the ignored entries of one batch. The batch path exists so a git-backed
 * policy answers in one process call instead of one per entry.
 */
async function admitEntries<T extends { rel: string }>(
  ignore: IgnorePolicy,
  entries: readonly T[],
): Promise<T[]> {
  if (ignore.filterIgnored) {
    const ignored = await ignore.filterIgnored(entries.map((e) => e.rel));
    return entries.filter((e) => !ignored.has(e.rel));
  }
  const kept: T[] = [];
  for (const e of entries) {
    if (!(await ignore.isIgnored(e.rel))) kept.push(e);
  }
  return kept;
}

/**
 * Directory and file names refused regardless of what git says. This is the
 * floor: it holds in a workspace that is not a git repository, and it covers
 * credential files that a repo may legitimately track.
 */
const DENIED_SEGMENTS = new Set([
  ".git",
  ".svn",
  ".hg",
  ".codecrosscheck",
  "node_modules",
  "bower_components",
  "dist",
  "out",
  "build",
  "bin",
  "obj",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".gradle",
  ".terraform",
]);

const DENIED_FILES: readonly RegExp[] = [
  /^\.env(\..+)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.(pem|key|pfx|p12|jks|keystore)$/i,
  /^.*\.secrets?\.(json|ya?ml|toml)$/i,
  /^secrets?\.(json|ya?ml|toml)$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
];

/** The always-on floor: build output, VCS metadata, and credential files. */
export function denylistPolicy(): IgnorePolicy {
  return {
    async isIgnored(rel: string): Promise<boolean> {
      const parts = rel.split("/").filter((s) => s.length > 0);
      if (parts.some((p) => DENIED_SEGMENTS.has(p))) return true;
      const base = parts[parts.length - 1] ?? "";
      return DENIED_FILES.some((re) => re.test(base));
    },
  };
}

export type CheckIgnore = (root: string, rels: readonly string[]) => Promise<Set<string>>;

/**
 * The denylist plus the repository's own `.gitignore` rules, consulted through
 * `git check-ignore`. A denylist alone cannot know what *this* repository
 * excludes; git is authoritative and honours nested and global ignore files.
 * When git is unavailable or the workspace is not a repository, the denylist
 * still applies.
 */
export function repositoryIgnorePolicy(root: string, checkIgnore: CheckIgnore = gitCheckIgnore): IgnorePolicy {
  const base = denylistPolicy();
  const cache = new Map<string, boolean>();
  let gitUsable = true;

  async function resolve(rels: readonly string[]): Promise<Set<string>> {
    const ignored = new Set<string>();
    const ask: string[] = [];
    for (const rel of rels) {
      if (await base.isIgnored(rel)) {
        ignored.add(rel);
        continue;
      }
      const cached = cache.get(rel);
      if (cached === undefined) {
        ask.push(rel);
      } else if (cached) {
        ignored.add(rel);
      }
    }
    if (ask.length === 0 || !gitUsable) return ignored;
    let answer: Set<string>;
    try {
      answer = await checkIgnore(root, ask);
    } catch {
      // Not a repository, or git is not installed. Stop asking.
      gitUsable = false;
      return ignored;
    }
    for (const rel of ask) {
      const hit = answer.has(rel);
      cache.set(rel, hit);
      if (hit) ignored.add(rel);
    }
    return ignored;
  }

  return {
    async isIgnored(rel: string): Promise<boolean> {
      return (await resolve([rel])).has(rel);
    },
    filterIgnored: resolve,
  };
}

/**
 * Ask git which of `rels` are ignored, in one process call. `--stdin` with `-z`
 * takes NUL-separated paths and echoes back the ignored ones verbatim, so no
 * path needs quoting and a whole directory listing costs a single spawn.
 * Exit 0 means at least one path is ignored, 1 means none are; anything else is
 * thrown so the caller can fall back rather than treat paths as readable on a
 * technicality.
 */
export async function gitCheckIgnore(root: string, rels: readonly string[]): Promise<Set<string>> {
  if (rels.length === 0) return new Set();
  const { execFile } = await import("node:child_process");
  return await new Promise<Set<string>>((resolve, reject) => {
    const child = execFile(
      "git",
      ["check-ignore", "-z", "--stdin"],
      { cwd: root, windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const code = (err as { code?: number | string } | null)?.code;
        if (err && code !== 1) return reject(err);
        resolve(new Set(stdout.split("\0").filter((p) => p.length > 0)));
      },
    );
    child.stdin?.on("error", reject);
    child.stdin?.end(rels.join("\0"));
  });
}

/** `ToolFs` backed by `node:fs/promises`. */
export function nodeToolFs(): ToolFs {
  return {
    readFile: async (abs) => (await import("node:fs/promises")).readFile(abs, "utf8"),
    async readDir(abs) {
      const fsp = await import("node:fs/promises");
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
    async exists(abs) {
      const fsp = await import("node:fs/promises");
      try {
        await fsp.access(abs);
        return true;
      } catch {
        return false;
      }
    },
  };
}
