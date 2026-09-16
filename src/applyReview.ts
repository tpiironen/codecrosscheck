import * as path from "node:path";
import {
  FixProposalSchema,
  type ApplyEdit,
  type FixProposal,
  type Issue,
  type Verdict,
} from "./schemas.js";

/**
 * Pure orchestration for the `/apply-review` slash command. All filesystem
 * access goes through the injected `FsLike` so the module is unit-testable
 * without VS Code or node:fs.
 */

export interface FsLike {
  readDir(dir: string): Promise<string[]>;
  stat(p: string): Promise<{ mtimeMs: number }>;
  readFile(p: string): Promise<string>;
  writeFile(p: string, content: string): Promise<void>;
  exists(p: string): Promise<boolean>;
}

export interface StoredFixProposal {
  /** The structured proposal, or null for a transcript written before 0.6. */
  proposal: FixProposal | null;
  /** Markdown rendition — derived for new runs, the worker's own prose for legacy ones. */
  artifact: string;
  /** The reviewer verdict that prompted that proposal, if available. */
  verdict: Verdict | null;
  /** Iteration number recorded in the transcript (best effort). */
  iteration: number;
}

export interface ApplyOutcome {
  path: string;
  status: "applied" | "skipped" | "dry-run";
  reason?: string;
  why: string;
}

/** Marks a completed `/review-branch` or `/openspec-review` run. */
const TERMINAL_EVENT = "review-branch-done";

/** How many trailing records to inspect when looking for the terminal event. */
const TAIL_RECORDS = 20;

/**
 * Returns the newest `*.jsonl` in `dir` whose run completed, or null.
 *
 * Matches a *parsed* terminal event near the tail rather than substring-testing
 * the whole file: a stored worker artifact can quote the event name verbatim
 * (a review of this codebase does), which a substring test reads as a
 * completed run.
 */
export async function findLatestTranscript(dir: string, fs: FsLike): Promise<string | null> {
  if (!(await fs.exists(dir))) return null;
  const entries = await fs.readDir(dir);
  const jsonls = entries.filter((e) => e.endsWith(".jsonl"));
  // Sort newest-first by mtime.
  const stamped: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of jsonls) {
    try {
      const st = await fs.stat(path.join(dir, name));
      stamped.push({ name, mtimeMs: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  stamped.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const { name } of stamped) {
    const full = path.join(dir, name);
    const text = await fs.readFile(full);
    if (hasTerminalEvent(text)) return full;
  }
  return null;
}

function hasTerminalEvent(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines.slice(-TAIL_RECORDS)) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && (obj as { event?: unknown }).event === TERMINAL_EVENT) {
      return true;
    }
  }
  return false;
}

/**
 * Delete all but the newest `keep` transcripts (and their `-apply.json`
 * siblings). Transcripts hold full source diffs, so an unbounded directory is
 * both a disk and a disclosure problem.
 */
export async function pruneTranscripts(
  dir: string,
  keep: number,
  fs: FsLike & { remove(p: string): Promise<void> },
): Promise<string[]> {
  if (keep < 0 || !(await fs.exists(dir))) return [];
  const entries = await fs.readDir(dir);
  const stamped: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of entries.filter((e) => e.endsWith(".jsonl"))) {
    try {
      const st = await fs.stat(path.join(dir, name));
      stamped.push({ name, mtimeMs: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  stamped.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const removed: string[] = [];
  for (const { name } of stamped.slice(keep)) {
    const full = path.join(dir, name);
    for (const victim of [full, full.replace(/\.jsonl$/i, "-apply.json")]) {
      try {
        if (await fs.exists(victim)) {
          await fs.remove(victim);
          removed.push(victim);
        }
      } catch {
        /* best-effort */
      }
    }
  }
  return removed;
}

/**
 * Parse a transcript JSONL and return the last `review-branch-iter` event with
 * `role: "worker"` (the final fix proposal). Also returns the most recent
 * preceding reviewer verdict, when present.
 *
 * Transcripts written before structured proposals carry only the Markdown
 * artifact; those are returned with a null `proposal` so the caller can say so
 * rather than silently applying nothing.
 */
export async function extractFixProposal(transcriptPath: string, fs: FsLike): Promise<StoredFixProposal | null> {
  const text = await fs.readFile(transcriptPath);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let lastWorker: { artifact: string; proposal: FixProposal | null; iteration: number } | null = null;
  let lastVerdict: Verdict | null = null;

  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const ev = obj as Record<string, unknown>;
    if (ev.event !== "review-branch-iter") continue;
    const role = ev.role;
    if (role === "worker" && typeof ev.artifact === "string") {
      const parsed = ev.proposal ? FixProposalSchema.safeParse(ev.proposal) : null;
      lastWorker = {
        artifact: ev.artifact,
        proposal: parsed?.success ? parsed.data : null,
        iteration: typeof ev.iteration === "number" ? ev.iteration : 0,
      };
    } else if (role === "reviewer" && ev.verdict && typeof ev.verdict === "object") {
      // Best-effort capture; may not match VerdictSchema if format drifted.
      lastVerdict = ev.verdict as Verdict;
    }
  }

  if (!lastWorker) return null;
  return {
    proposal: lastWorker.proposal,
    artifact: lastWorker.artifact,
    verdict: lastVerdict,
    iteration: lastWorker.iteration,
  };
}

/**
 * Fingerprint a reviewer issue by `${severity}|${where}|${why}` (trimmed) so
 * a near-identical restatement of the same finding in a later round can be
 * matched against an earlier worker rebuttal. `suggestion` is excluded
 * because reviewers often re-word it; the (severity, where, why) triple is
 * stable enough to identify the same concern.
 */
export function issueFingerprint(it: { severity: string; where: string; why: string }): string {
  return `${it.severity}|${it.where.trim()}|${it.why.trim()}`;
}

/**
 * Drop verdict issues whose fingerprint matches one in `rejected`.
 *
 * This never decides the verdict. When filtering empties the issue list it
 * reports `emptiedBySuppression` and leaves the verdict untouched, because
 * "the worker rebutted everything" is not the same outcome as "the reviewer
 * approved" and must not be presented as one.
 */
export function filterRejectedIssues<V extends { verdict: string; issues: Array<{ severity: string; where: string; why: string }> }>(
  verdict: V,
  rejected: ReadonlySet<string>,
): { verdict: V; dropped: number; emptiedBySuppression: boolean } {
  if (rejected.size === 0) return { verdict, dropped: 0, emptiedBySuppression: false };
  const kept = verdict.issues.filter((it) => !rejected.has(issueFingerprint(it)));
  const dropped = verdict.issues.length - kept.length;
  if (dropped === 0) return { verdict, dropped: 0, emptiedBySuppression: false };
  return {
    verdict: { ...verdict, issues: kept },
    dropped,
    emptiedBySuppression: kept.length === 0,
  };
}

/** Result of running a post-apply build/verify command. */
export interface BuildGateResult {
  /** Exit code (0 = success). `null` if the command timed out or failed to spawn. */
  exitCode: number | null;
  /** Whether the command timed out. */
  timedOut: boolean;
  /** Combined stdout+stderr, truncated to a sensible chat-display size. */
  output: string;
  /** Whether `output` was truncated. */
  truncated: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

/**
 * Spawn a shell command in `cwd`, capture combined stdout+stderr, return the
 * exit code and (truncated) output. Used by `/apply-review` after successful
 * edits to verify the working tree still compiles/tests.
 *
 * This is the one place the repo's "never `exec` a string" rule is relaxed:
 * the value is a user-authored command line (`npm run build`, `dotnet build
 * -nologo`) that only a shell can interpret. The setting is contributed with
 * `scope: "machine"` so a workspace cannot supply it, and `/apply-review`
 * additionally requires a trusted workspace before calling this.
 */
export interface RunBuildGateOptions {
  cwd: string;
  command: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Defaults to `child_process.exec`; tests inject a stub. */
  runner?: (
    command: string,
    options: { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean },
    cb: (
      err: (Error & { code?: number | string; killed?: boolean; signal?: NodeJS.Signals | null }) | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => void;
}

export async function runBuildGate(opts: RunBuildGateOptions): Promise<BuildGateResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const maxOutputBytes = opts.maxOutputBytes ?? 16 * 1024;
  // Lazy import so the (rare) tests that stub `runner` don't pay for it.
  const runner = opts.runner ?? (await import("node:child_process")).exec;
  const startedAt = Date.now();
  return await new Promise<BuildGateResult>((resolve) => {
    runner(
      opts.command,
      {
        cwd: opts.cwd,
        timeout: timeoutMs,
        // Allow a generous internal buffer; we'll truncate ourselves.
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const combined = `${stdout ?? ""}${stderr ?? ""}`;
        const truncated = combined.length > maxOutputBytes;
        const output = truncated
          ? combined.slice(0, maxOutputBytes) + `\n\n_(truncated; ${combined.length - maxOutputBytes} more bytes)_`
          : combined;
        if (err) {
          // node spawns `killed=true` on timeout (SIGTERM).
          const timedOut = Boolean(err.killed) && err.signal === "SIGTERM";
          const exitCode =
            typeof err.code === "number" ? err.code : timedOut ? null : null;
          resolve({ exitCode, timedOut, output, truncated, durationMs });
          return;
        }
        resolve({ exitCode: 0, timedOut: false, output, truncated, durationMs });
      },
    );
  });
}

/**
 * Validate a proposed edit's path: must resolve under `workspaceRoot` after
 * normalisation, must not be absolute, must not escape via `..`. Returns the
 * absolute path on success or a reason string on failure.
 */
export function resolveSafePath(workspaceRoot: string, candidate: string): { ok: true; abs: string } | { ok: false; reason: string } {
  if (path.isAbsolute(candidate)) {
    return { ok: false, reason: "path is absolute" };
  }
  const abs = path.resolve(workspaceRoot, candidate);
  const rootResolved = path.resolve(workspaceRoot);
  const rel = path.relative(rootResolved, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "path outside workspace" };
  }
  return { ok: true, abs };
}

/**
 * Keep the head and tail of `text` within `budget`, marking the elision. A
 * caller may cite a symbol anywhere in the file, so a head-only cut would
 * systematically hide the end.
 */
export function truncateMiddle(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const marker = `\n\n… ${(text.length - budget).toLocaleString("en-US")} characters elided …\n\n`;
  const keep = Math.max(0, budget - marker.length);
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return text.slice(0, head) + marker + (tail > 0 ? text.slice(text.length - tail) : "");
}

/**
 * Every applicable edit in a fix proposal, in the order the worker listed
 * them. Only `fixed` entries contribute: the schema already refuses edits on
 * any other status, and this second gate means a transcript written before
 * that rule — or a hand-edited one — still cannot apply an edit the UI
 * presents as rebutted or unaddressed.
 */
export function editsFrom(proposal: FixProposal): ApplyEdit[] {
  return proposal.fixes.filter((f) => f.status === "fixed").flatMap((f) => f.edits);
}

/**
 * Check that a proposal answers exactly the findings it was given: one entry
 * per finding, each `findingId` in `1..findingCount`, each used once. The
 * schema cannot express this — it does not know how many findings there were —
 * so a model can otherwise drop a finding silently or answer one twice, and
 * the rendered Markdown would look complete.
 *
 * Returns null when the proposal is well-formed, or a one-line problem
 * description suitable for a reprompt.
 */
export function validateFixCoverage(proposal: FixProposal, findingCount: number): string | null {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const fix of proposal.fixes) {
    if (fix.findingId < 1 || fix.findingId > findingCount) {
      problems.push(`findingId ${fix.findingId} is outside 1..${findingCount}`);
      continue;
    }
    if (seen.has(fix.findingId)) {
      problems.push(`findingId ${fix.findingId} appears more than once`);
      continue;
    }
    seen.add(fix.findingId);
  }
  const missing: number[] = [];
  for (let id = 1; id <= findingCount; id++) {
    if (!seen.has(id)) missing.push(id);
  }
  if (missing.length > 0) problems.push(`no entry for finding(s) ${missing.join(", ")}`);
  if (problems.length === 0) return null;
  return `Expected exactly ${findingCount} fix entries, one per finding, with findingId 1..${findingCount} used once each: ${problems.join("; ")}.`;
}

/**
 * Render a structured fix proposal as Markdown, for display and for the
 * reviewer's re-review pass. The model no longer writes this prose — it is
 * derived from the structured response, so the two cannot disagree.
 */
export function renderFixProposal(proposal: FixProposal, issues: Issue[] = []): string {
  const label = { fixed: "Fixed", disagree: "Disagree", unaddressed: "Unaddressed" } as const;
  const parts: string[] = ["## Summary", "", proposal.summary];
  for (const fix of proposal.fixes) {
    const issue = issues[fix.findingId - 1];
    const heading = issue ? `${fix.findingId}: ${issue.where}` : `${fix.findingId}`;
    parts.push("", `### Finding ${heading} — ${label[fix.status]}`, "", fix.explanation);
    for (const edit of fix.edits) {
      parts.push(
        "",
        `**Edit** \`${edit.path}\` — ${edit.why}`,
        "",
        "```diff",
        ...edit.oldString.split("\n").map((l) => `-${l}`),
        ...edit.newString.split("\n").map((l) => `+${l}`),
        "```",
      );
    }
  }
  return parts.join("\n");
}

/** Apply a single edit. Returns outcome; never throws on validation failures. */
export async function applyEdit(
  workspaceRoot: string,
  edit: ApplyEdit,
  fs: FsLike,
  options: { dryRun: boolean },
): Promise<ApplyOutcome> {
  const safe = resolveSafePath(workspaceRoot, edit.path);
  if (!safe.ok) {
    return { path: edit.path, status: "skipped", reason: safe.reason, why: edit.why };
  }
  const exists = await fs.exists(safe.abs);

  // Empty oldString => create new file (newString becomes the file contents).
  if (edit.oldString === "") {
    if (exists) {
      return { path: edit.path, status: "skipped", reason: "file already exists (oldString empty implies create)", why: edit.why };
    }
    if (options.dryRun) {
      return { path: edit.path, status: "dry-run", why: edit.why };
    }
    await fs.writeFile(safe.abs, edit.newString);
    return { path: edit.path, status: "applied", why: edit.why };
  }

  if (!exists) {
    return { path: edit.path, status: "skipped", reason: "file not found", why: edit.why };
  }
  const original = await fs.readFile(safe.abs);

  const match = matchEdit(original, edit.oldString, edit.newString);
  if (!match.ok) {
    return { path: edit.path, status: "skipped", reason: match.reason, why: edit.why };
  }

  if (options.dryRun) {
    return { path: edit.path, status: "dry-run", why: edit.why };
  }
  // Splice by index rather than String.replace: GetSubstitution expands `$$`,
  // `$&`, "$`" and `$'` in the replacement even for a string search value.
  const updated =
    original.slice(0, match.at) + match.replacement + original.slice(match.at + match.matched.length);
  await fs.writeFile(safe.abs, updated);
  return { path: edit.path, status: "applied", why: edit.why };
}

/** `oldString` as written, and its pure-LF and pure-CRLF forms. Most literal first. */
export function lineEndingVariants(raw: string): string[] {
  const lf = raw.replace(/\r\n/g, "\n");
  return Array.from(new Set([raw, lf, lf.replace(/\n/g, "\r\n")]));
}

/**
 * Locate `oldString` in `original`, tolerating line-ending drift and nothing
 * else, and pair `newString` to whichever form matched.
 *
 * Line endings are the one difference the model cannot be held to. It reads the
 * file through the toolset — `read_file` preserves CRLF exactly — but emits LF
 * in its JSON regardless: on the 2026-09-16 dogfood run, 11 of 12 edits against
 * a CRLF worktree were skipped as "oldString not found", every `oldString`
 * carrying LF where the file had CRLF. Structured output did not fix that, so
 * the earlier reasoning for requiring a byte-exact match was wrong.
 *
 * Any *other* mismatch is still a hard failure. A near-miss means the edit is
 * wrong, and repairing it would hide that.
 */
export function matchEdit(
  original: string,
  oldString: string,
  newString: string,
): { ok: true; at: number; matched: string; replacement: string } | { ok: false; reason: string } {
  let ambiguous = 0;
  for (const candidate of lineEndingVariants(oldString)) {
    const count = countOccurrences(original, candidate);
    if (count > 1) {
      ambiguous = Math.max(ambiguous, count);
      continue;
    }
    if (count === 0) continue;
    const lfNew = newString.replace(/\r\n/g, "\n");
    return {
      ok: true,
      at: original.indexOf(candidate),
      matched: candidate,
      replacement: candidate.includes("\r\n") ? lfNew.replace(/\n/g, "\r\n") : lfNew,
    };
  }
  return {
    ok: false,
    reason: ambiguous > 0 ? `oldString matches ${ambiguous} times` : "oldString not found",
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** Destination for a committed batch of whole-file writes. */
export interface EditHost {
  commit(writes: Array<{ path: string; content: string }>): Promise<void>;
}

/**
 * Buffers writes over a base filesystem so a batch can be inspected and
 * committed as a unit, and so a later edit in the batch sees earlier ones.
 */
function overlayFs(base: FsLike): FsLike & { pending(): Array<{ path: string; content: string }> } {
  const buffered = new Map<string, string>();
  return {
    readDir: (dir) => base.readDir(dir),
    stat: (p) => base.stat(p),
    async readFile(p) {
      const held = buffered.get(p);
      return held !== undefined ? held : base.readFile(p);
    },
    async writeFile(p, content) {
      buffered.set(p, content);
    },
    async exists(p) {
      return buffered.has(p) ? true : base.exists(p);
    },
    pending: () => Array.from(buffered, ([path, content]) => ({ path, content })),
  };
}

/**
 * Apply many edits in order, committing them only once every edit has been
 * computed, so a failure partway leaves the tree untouched.
 */
export async function applyEdits(
  workspaceRoot: string,
  edits: ApplyEdit[],
  fs: FsLike,
  options: { dryRun: boolean; host?: EditHost },
): Promise<ApplyOutcome[]> {
  const overlay = overlayFs(fs);
  const results: ApplyOutcome[] = [];
  for (const e of edits) {
    results.push(await applyEdit(workspaceRoot, e, overlay, options));
  }
  if (options.dryRun) return results;

  const writes = overlay.pending();
  if (writes.length === 0) return results;
  if (options.host) {
    await options.host.commit(writes);
  } else {
    for (const w of writes) await fs.writeFile(w.path, w.content);
  }
  return results;
}

// Exposed for tests.
export const __test = { countOccurrences };
