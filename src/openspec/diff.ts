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
    const header = block.split("\n", 1)[0] ?? "";
    const m = header.match(/^diff --git a\/(\S+) b\/(\S+)/);
    const file = m?.[2] ?? m?.[1] ?? "";
    if (scopePaths.some((p) => file === p || file.startsWith(p.endsWith("/") ? p : p + "/"))) {
      kept.push(block);
    }
  }
  return kept.join("");
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
