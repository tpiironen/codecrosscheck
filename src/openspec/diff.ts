import { spawn } from "node:child_process";

export interface DiffOptions {
  cwd?: string;
  /** If omitted, the diff is computed against the merge-base with `origin/main`, falling back to `HEAD`. */
  baseRef?: string;
  /** Only include hunks whose file path starts with one of these prefixes (the change's stated impact). */
  scopePaths?: string[];
  /**
   * Compare commits only, excluding the working tree. Default `false`: a
   * review should cover what the author is looking at, not the previous commit.
   */
  committedOnly?: boolean;
}

export interface ChangeDiff {
  patch: string;
  /** Human-readable account of what was compared, for the review header. */
  description: string;
}

/**
 * Diff the branch against its base.
 *
 * By default the comparison runs base..working tree, so staged and unstaged
 * edits to tracked files are included. Untracked files are excluded: git does
 * not track them, and sweeping them in risks pulling build output and secrets
 * into a model prompt.
 */
export async function getChangeDiff(opts: DiffOptions = {}): Promise<ChangeDiff> {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.baseRef ?? (await resolveMergeBase(cwd));

  // `base` is already a resolved commit, so a two-dot range is exact and also
  // works for orphan refs that share no history.
  const args = opts.committedOnly ? ["diff", `${base}..HEAD`] : ["diff", base];
  const raw = await runGit(args, cwd);

  const baseLabel = opts.baseRef ?? `merge-base ${short(base)}`;
  const description = opts.committedOnly
    ? `committed changes vs ${baseLabel}`
    : `working tree vs ${baseLabel}, including staged and unstaged edits to tracked files`;

  const patch =
    !opts.scopePaths || opts.scopePaths.length === 0
      ? raw
      : filterPatchToScope(raw, opts.scopePaths);
  return { patch, description };
}

function short(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 8) : ref;
}

async function resolveMergeBase(cwd: string): Promise<string> {
  for (const remote of ["origin/main", "origin/master"]) {
    try {
      const out = await runGit(["merge-base", "HEAD", remote], cwd);
      if (out.trim()) return out.trim();
    } catch {
      // try next
    }
  }
  return "HEAD";
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`));
    });
  });
}

/** Split a unified-diff patch into per-file blocks; keep blocks whose path matches `scopePaths`. */
export function filterPatchToScope(patch: string, scopePaths: string[]): string {
  const blocks = patch.split(/^(?=diff --git )/m);
  const kept: string[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const file = blockPath(block);
    if (scopePaths.some((p) => file === p || file.startsWith(p.endsWith("/") ? p : p + "/"))) {
      kept.push(block);
    }
  }
  return kept.join("");
}

/** The post-image path of every per-file block in a patch, in patch order. */
export function patchPaths(patch: string): string[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((b) => b.trim())
    .map(blockPath)
    .filter((p) => p.length > 0);
}

/**
 * The path a per-file block is about.
 *
 * Marker lines state exactly one path each, so they are read first: `+++ `,
 * then `--- ` for a deletion (`+++ /dev/null`), then `rename to` for a
 * content-free rename. A mode-only block carries none of those, so the
 * `diff --git` header must be parsed directly - and there a `\S+` pattern is
 * wrong twice over: an unquoted path may contain spaces, and git C-quotes any
 * path with spaces or non-ASCII bytes.
 */
function blockPath(block: string): string {
  const lines = block.split("\n");
  const post = pathFromMarker(lines, "+++ ");
  if (post) return post;
  const pre = pathFromMarker(lines, "--- ");
  if (pre) return pre;
  for (const line of lines) {
    if (line.startsWith("rename to ")) {
      return stripDiffPrefix(decodeQuotedPath(line.slice("rename to ".length).trimEnd()));
    }
  }
  return headerPath(lines[0] ?? "");
}

/** The path on the first `marker` line, or "" if absent or `/dev/null`. */
function pathFromMarker(lines: string[], marker: string): string {
  for (const line of lines) {
    if (!line.startsWith(marker)) continue;
    const decoded = decodeQuotedPath(line.slice(marker.length).trimEnd());
    if (!decoded || decoded === "/dev/null") return "";
    return stripDiffPrefix(decoded);
  }
  return "";
}

/**
 * The post-image path from a `diff --git` header, handling both C-quoted
 * tokens and unquoted paths containing spaces. For the unquoted case the split
 * point is the space at which `a/P` and `b/P` name the same path; a rename
 * header falls back to the trailing `b/` token.
 */
function headerPath(header: string): string {
  if (!header.startsWith("diff --git ")) return "";
  const rest = header.slice("diff --git ".length).trimEnd();
  if (rest.startsWith('"')) {
    const first = readQuotedToken(rest);
    const second = first.remainder.trimStart();
    const post = second.startsWith('"') ? readQuotedToken(second).path : decodeQuotedPath(second);
    return stripDiffPrefix(post || first.path);
  }
  for (let i = rest.indexOf(" "); i !== -1; i = rest.indexOf(" ", i + 1)) {
    const a = rest.slice(0, i);
    const b = rest.slice(i + 1);
    if (a.startsWith("a/") && b.startsWith("b/") && a.slice(2) === b.slice(2)) return a.slice(2);
  }
  const m = rest.match(/^a\/(\S+) b\/(\S+)$/);
  return m ? (m[2] ?? "") : stripDiffPrefix(rest);
}

/** Read one quoted token from the head of `s`; returns its decoded path and the remainder. */
function readQuotedToken(s: string): { path: string; remainder: string } {
  let i = 1;
  for (; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === '"') break;
  }
  return { path: decodeQuotedPath(s.slice(0, i + 1)), remainder: s.slice(i + 1) };
}

/** Strip the `a/` or `b/` diff prefix git puts on both sides. */
function stripDiffPrefix(p: string): string {
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}

/** Undo git's C-style quoting; pass anything unquoted through unchanged. */
function decodeQuotedPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      bytes.push(...Buffer.from(body[i]!, "utf8"));
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    const octal = body.slice(i, i + 3);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 2;
      continue;
    }
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92 };
    bytes.push(simple[next] ?? Buffer.from(next, "utf8")[0]!);
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Count the per-file blocks in a unified-diff patch. */
export function countPatchFiles(patch: string): number {
  return patch.split(/^(?=diff --git )/m).filter((b) => b.trim()).length;
}

export interface ScopedPatch {
  patch: string;
  included: number;
  omitted: number;
  /** False when `paths` matched nothing and the full patch was kept instead. */
  scoped: boolean;
}

/**
 * Narrow a patch to `paths` for a re-review prompt. Falls back to the whole
 * patch when nothing matches — an empty diff would tell the reviewer the
 * branch changed nothing, which is worse than sending too much.
 */
export function scopePatchToPaths(patch: string, paths: string[]): ScopedPatch {
  const total = countPatchFiles(patch);
  if (paths.length === 0) return { patch, included: total, omitted: 0, scoped: false };

  const filtered = filterPatchToScope(patch, paths);
  if (!filtered.trim()) return { patch, included: total, omitted: 0, scoped: false };

  const included = countPatchFiles(filtered);
  return { patch: filtered, included, omitted: Math.max(0, total - included), scoped: true };
}

/** Estimate tokens as ceil(chars / 4); split a patch into per-file chunks under `budgetTokens`. */
export function chunkPatch(patch: string, budgetTokens: number): string[] {
  const budgetChars = budgetTokens * 4;
  const blocks = patch.split(/^(?=diff --git )/m).filter((b) => b.trim());
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if (block.length > budgetChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      // Split a single large file by 100-line windows with 2-line overlap.
      const lines = block.split("\n");
      const windowSize = 100;
      const overlap = 2;
      for (let i = 0; i < lines.length; i += windowSize - overlap) {
        chunks.push(lines.slice(i, i + windowSize).join("\n"));
      }
      continue;
    }
    if ((current + block).length > budgetChars) {
      if (current) chunks.push(current);
      current = block;
    } else {
      current += block;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
