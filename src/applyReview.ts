import * as path from "node:path";
import { z } from "zod";
import type { ChatClient, ChatMessage } from "./clients/ChatClient.js";
import { ApplyReviewSchema, type ApplyEdit, type Verdict } from "./schemas.js";

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

export interface FixProposal {
  /** The worker's most recent fix-proposal Markdown artifact. */
  proposal: string;
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

/** Returns the newest `*.jsonl` in `dir` containing a `review-branch-done` event, or null. */
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
    if (text.includes("\"review-branch-done\"") || text.includes('"event":"review-branch-done"')) {
      return full;
    }
  }
  return null;
}

/**
 * Parse a transcript JSONL and return the last `review-branch-iter` event with
 * `role: "worker"` (the final fix proposal). Also returns the most recent
 * preceding reviewer verdict, when present.
 */
export async function extractFixProposal(transcriptPath: string, fs: FsLike): Promise<FixProposal | null> {
  const text = await fs.readFile(transcriptPath);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let lastWorker: { artifact: string; iteration: number } | null = null;
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
      lastWorker = {
        artifact: ev.artifact,
        iteration: typeof ev.iteration === "number" ? ev.iteration : 0,
      };
    } else if (role === "reviewer" && ev.verdict && typeof ev.verdict === "object") {
      // Best-effort capture; may not match VerdictSchema if format drifted.
      lastVerdict = ev.verdict as Verdict;
    }
  }

  if (!lastWorker) return null;
  return {
    proposal: lastWorker.artifact,
    verdict: lastVerdict,
    iteration: lastWorker.iteration,
  };
}

/** A single worker rebuttal extracted from a fix proposal. */
export interface Disagreement {
  /** 1-based index matching the issue number in the proposal. */
  id: number;
  /** The "Issue N: ..." heading, used to tie back to the reviewer finding. */
  heading: string;
  /** The worker's rebuttal paragraph (everything after `**Fix:** Disagree:`). */
  rebuttal: string;
}

/**
 * Parse `**Fix:** Disagree: ...` rebuttals out of a fixer proposal Markdown.
 * Returns one entry per Issue section whose Fix paragraph starts with "Disagree:".
 */
export function parseDisagreements(proposal: string): Disagreement[] {
  const out: Disagreement[] = [];
  // Split on top-level "### Issue N: ..." headings.
  const sectionRe = /^###\s+Issue\s+(\d+)[^\n]*$/gm;
  const headings: { id: number; heading: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(proposal)) !== null) {
    headings.push({
      id: Number.parseInt(m[1], 10),
      heading: m[0].replace(/^###\s+/, "").trim(),
      start: m.index,
    });
  }
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].start;
    const end = i + 1 < headings.length ? headings[i + 1].start : proposal.length;
    const body = proposal.slice(start, end);
    // Look for "**Fix:** Disagree:" (allow whitespace variations).
    const fixMatch = body.match(/\*\*Fix:\*\*\s*Disagree\s*:\s*([\s\S]*?)(?=\n\n\*\*|\n###|\n```|$)/i);
    if (!fixMatch) continue;
    out.push({
      id: headings[i].id,
      heading: headings[i].heading,
      rebuttal: fixMatch[1].trim(),
    });
  }
  return out;
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
 * Drop verdict issues whose fingerprint matches one in `rejected`. If the
 * filter empties the issues array, the returned verdict is auto-approved
 * because there is nothing left to revise. Returns the (possibly new)
 * verdict and the count of dropped issues.
 */
export function filterRejectedIssues<V extends { verdict: string; issues: Array<{ severity: string; where: string; why: string }> }>(
  verdict: V,
  rejected: ReadonlySet<string>,
): { verdict: V; dropped: number } {
  if (rejected.size === 0) return { verdict, dropped: 0 };
  const kept = verdict.issues.filter((it) => !rejected.has(issueFingerprint(it)));
  const dropped = verdict.issues.length - kept.length;
  if (dropped === 0) return { verdict, dropped: 0 };
  const next = { ...verdict, issues: kept } as V;
  if (kept.length === 0 && next.verdict !== "approve") {
    (next as { verdict: string }).verdict = "approve";
  }
  return { verdict: next, dropped };
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
 * edits to verify the working tree still compiles/tests. Pure I/O, no
 * vscode dep — testable with a real subprocess.
 *
 * Injects `child_process.exec` via `runner` so tests can stub it. Keeps a
 * hard timeout (default 5 min) and an output cap (default 16 KB) so a
 * runaway build can't hang the chat session or flood the log.
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

/** A finding the worker effectively skipped without using the explicit `Disagree:` token. */
export interface BlockedFinding {
  /** 1-based index matching the issue number in the proposal. */
  id: number;
  /** The "Issue N: ..." heading. */
  heading: string;
  /** Short reason describing which dodge pattern matched. */
  reason: string;
}

/**
 * Detect per-issue sections where the worker dodged producing a concrete
 * patch — e.g. responded with `**Data I need:**`, `(sketch — pending current
 * source)`, or `I cannot produce the unified-diff hunk` — but did not use
 * the explicit `**Fix:** Disagree:` token. These look like real fixes at a
 * glance but are not actionable, so we surface them alongside disagreements
 * for adjudication. Issues that already match `parseDisagreements` are
 * excluded so they aren't reported twice.
 */
export function parseBlockedFindings(proposal: string): BlockedFinding[] {
  const out: BlockedFinding[] = [];
  const disagreedIds = new Set(parseDisagreements(proposal).map((d) => d.id));
  const sectionRe = /^###\s+Issue\s+(\d+)[^\n]*$/gm;
  const headings: { id: number; heading: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(proposal)) !== null) {
    headings.push({
      id: Number.parseInt(m[1], 10),
      heading: m[0].replace(/^###\s+/, "").trim(),
      start: m.index,
    });
  }
  const dodgePatterns: { re: RegExp; reason: string }[] = [
    { re: /\*\*Data I need(?: to produce the patch)?[:\*]/i, reason: "asks for more source files" },
    { re: /\(sketch\s*[\u2014\-]\s*pending current source/i, reason: "code block marked sketch / pending current source" },
    { re: /I cannot produce (?:the |a )?(?:unified-diff hunk|patch|fix)/i, reason: "explicitly refuses to produce a patch" },
    { re: /pending (?:the )?(?:current )?source(?:\s+(?:of|for))?/i, reason: "deferred pending source" },
  ];
  for (let i = 0; i < headings.length; i++) {
    if (disagreedIds.has(headings[i].id)) continue;
    const start = headings[i].start;
    const end = i + 1 < headings.length ? headings[i + 1].start : proposal.length;
    const body = proposal.slice(start, end);
    for (const { re, reason } of dodgePatterns) {
      if (re.test(body)) {
        out.push({ id: headings[i].id, heading: headings[i].heading, reason });
        break;
      }
    }
  }
  return out;
}

/** Extract unique workspace-relative paths from `// path: <file>` directives in the proposal. */
export function parseReferencedFiles(proposal: string): string[] {
  const re = /^\s*\/\/\s*path:\s*([^\s].*?)\s*$/gm;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(proposal)) !== null) {
    const cleaned = normalizeReferencedPath(m[1]);
    if (cleaned.length > 0) found.add(cleaned);
  }
  return Array.from(found);
}

/**
 * Extract any plausible workspace-relative file paths from arbitrary text —
 * used to harvest paths from reviewer findings (`where` fields) and from the
 * worker's prose ("Data I need: full current contents of …").
 *
 * Heuristic: token contains a `/`, ends in a recognised source extension,
 * does not start with `http://` or absolute drive prefix.
 */
export function harvestPathsFromText(text: string): string[] {
  const found = new Set<string>();
  // Match runs of non-whitespace, non-quote characters that look like a path.
  const re = /([A-Za-z0-9_.\-]+(?:[\\/][A-Za-z0-9_.\-]+)+\.(?:cs|ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|kt|rb|sql|yml|yaml|bicep|csproj|sln|xml|cshtml|razor|css|scss))(?::\d+(?:-\d+)?)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Reject when preceded by URL scheme `://`, drive prefix `:/` or `:\`,
    // or the substring forms part of a URL host (`<ident>://`).
    const start = m.index;
    const before2 = start >= 2 ? text.slice(start - 2, start) : "";
    const before3 = start >= 3 ? text.slice(start - 3, start) : "";
    if (before2 === "//" || before2 === ":/" || before2 === ":\\") continue;
    if (before3.endsWith("://")) continue;
    // Reject "host.tld/path.ext" patterns by skipping if first segment looks
    // like a hostname (contains a dot, the matched path itself starts with the
    // hostname). Heuristic: if the first segment before the first slash has a
    // dot AND is followed by no further dot-extension before the slash, treat
    // as host. Simpler: reject if the captured path's first segment ends with
    // a known TLD-ish pattern AND is followed by `/`.
    let p = m[1].replace(/\\/g, "/");
    const firstSlash = p.indexOf("/");
    if (firstSlash > 0) {
      const head = p.slice(0, firstSlash);
      if (/^[A-Za-z0-9-]+\.(com|org|net|io|dev|ai|co|gov|edu|uk|de|fr)$/i.test(head)) {
        continue;
      }
    }
    if (/^[A-Za-z]+:\/\//.test(p)) continue;
    if (/^[A-Za-z]:\//.test(p)) continue;
    p = normalizeReferencedPath(p);
    if (p.length > 0) found.add(p);
  }
  return Array.from(found);
}

/**
 * Strip annotations the worker commonly tacks onto path directives:
 *  - trailing parenthetical comments: `foo.cs (excerpt)`, `foo.cs (new file)`
 *  - line-number suffixes: `foo.cs:21`, `foo.cs:21-30`
 *  - surrounding backticks
 */
export function normalizeReferencedPath(raw: string): string {
  let p = raw.trim();
  // Strip wrapping backticks.
  p = p.replace(/^`+|`+$/g, "").trim();
  // Strip a single trailing parenthetical annotation ("(excerpt)", "(new file)", ...).
  p = p.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // Strip a trailing :line or :line-line suffix.
  p = p.replace(/:\d+(?:-\d+)?$/, "").trim();
  return p;
}

/**
 * If `candidate` doesn't exist directly under `workspaceRoot`, progressively
 * drop leading path segments and return the first variant that exists. This
 * recovers from worker-supplied repo-relative paths when the workspace is
 * actually a subdirectory of the repo (very common in monorepos).
 */
export async function resolveReferencedPath(
  workspaceRoot: string,
  candidate: string,
  fs: FsLike,
): Promise<string> {
  const safe = resolveSafePath(workspaceRoot, candidate);
  if (safe.ok && (await fs.exists(safe.abs))) return candidate;

  // Try dropping leading segments one at a time.
  const parts = candidate.split(/[\\/]/).filter((s) => s.length > 0);
  for (let i = 1; i < parts.length; i++) {
    const trimmed = parts.slice(i).join("/");
    const trySafe = resolveSafePath(workspaceRoot, trimmed);
    if (trySafe.ok && (await fs.exists(trySafe.abs))) {
      return trimmed;
    }
  }
  return candidate;
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

/** Read each referenced file (annotating missing ones as "to be created") and return a Markdown inventory. */
export async function buildFileInventory(
  workspaceRoot: string,
  paths: string[],
  fs: FsLike,
): Promise<{ inventory: string; missing: string[]; resolved: Map<string, string> }> {
  const parts: string[] = [];
  const missing: string[] = [];
  const resolved = new Map<string, string>();
  for (const rel of paths) {
    // Try to resolve repo-prefixed paths to actual workspace-relative paths.
    const effective = await resolveReferencedPath(workspaceRoot, rel, fs);
    resolved.set(rel, effective);
    const safe = resolveSafePath(workspaceRoot, effective);
    if (!safe.ok) {
      missing.push(`${rel} (${safe.reason})`);
      continue;
    }
    if (!(await fs.exists(safe.abs))) {
      // File doesn't exist yet — surface to the worker so it can emit a
      // creation edit (oldString="") if the proposal calls for it.
      parts.push(`## File: ${effective} (does not exist yet — emit a creation edit with oldString="" to create it, or skip if the proposal doesn't call for a new file)`);
      continue;
    }
    const content = await fs.readFile(safe.abs);
    const header = effective === rel
      ? `## File: ${effective}`
      : `## File: ${effective} (proposal referenced as \`${rel}\` — use the resolved path \`${effective}\` in your edits)`;
    parts.push(`${header}\n\n\`\`\`\n${content}\n\`\`\``);
  }
  return { inventory: parts.join("\n\n"), missing, resolved };
}

/** Compose the worker user message from the fix proposal and file inventory. */
export function composeApplyInput(proposal: string, inventory: string): string {
  return [
    "# Fix proposal",
    "",
    proposal,
    "",
    "# Current file contents",
    "",
    inventory.length > 0 ? inventory : "_(no files supplied — return empty edits)_",
  ].join("\n");
}

/** Call the worker model and return validated edits. */
export async function deriveEdits(
  client: ChatClient,
  systemPrompt: string,
  userInput: string,
): Promise<ApplyEdit[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];
  const result = await client.sendStructured(messages, ApplyReviewSchema, "ApplyReview");
  return result.edits;
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

  // Try the model's oldString as-is, then a sequence of safety-net repairs:
  // 1. Strip diff markers (the worker pasted unified-diff lines).
  // 2. Normalise CRLF / leading-tab vs leading-spaces drift.
  const candidates = buildOldStringCandidates(edit.oldString);
  let matchedOld: string | null = null;
  for (const cand of candidates) {
    const c = countOccurrences(original, cand);
    if (c === 1) {
      matchedOld = cand;
      break;
    }
  }
  if (matchedOld === null) {
    // Diagnose with the original oldString so the message is meaningful.
    const c = countOccurrences(original, edit.oldString);
    if (c === 0) {
      return { path: edit.path, status: "skipped", reason: "oldString not found", why: edit.why };
    }
    return { path: edit.path, status: "skipped", reason: `oldString matches ${c} times`, why: edit.why };
  }

  // Pair newString with the same repair that worked for oldString.
  const repairedNew = repairNewStringFor(matchedOld, edit.oldString, edit.newString);

  if (options.dryRun) {
    return { path: edit.path, status: "dry-run", why: edit.why };
  }
  const updated = original.replace(matchedOld, repairedNew);
  await fs.writeFile(safe.abs, updated);
  return { path: edit.path, status: "applied", why: edit.why };
}

/**
 * Build candidate forms of `oldString` to try against the file. Order matters
 * — first match wins, so list more conservative repairs first.
 */
export function buildOldStringCandidates(raw: string): string[] {
  const out: string[] = [];
  const add = (s: string): void => {
    if (s.length > 0 && !out.includes(s)) out.push(s);
  };
  add(raw);
  // CRLF/CR -> LF normalisation (file has LF, worker emitted CRLF).
  const lf = raw.replace(/\r\n?/g, "\n");
  add(lf);
  // LF -> CRLF (file has CRLF, worker emitted LF — common on Windows repos).
  add(lf.replace(/\n/g, "\r\n"));
  // Diff-style: keep ' ' + '-' lines, strip the one-char marker (LF form).
  const stripped = stripDiffMarkers(lf, "old");
  if (stripped !== lf) {
    add(stripped);
    add(stripped.replace(/\n/g, "\r\n"));
  }
  return out;
}

/**
 * Pair `newString` with the same repair that produced `matchedOld`. If the
 * old candidate that matched was the diff-stripped variant, strip diff markers
 * from `newString` too. If it was the CRLF variant, emit CRLF in newString too.
 */
export function repairNewStringFor(matchedOld: string, originalOld: string, originalNew: string): string {
  const lfNew = originalNew.replace(/\r\n?/g, "\n");
  const lfOld = originalOld.replace(/\r\n?/g, "\n");

  const wasStripped = matchedOld === stripDiffMarkers(lfOld, "old") && matchedOld !== lfOld;
  const usesCrlf = matchedOld.includes("\r\n");

  let result = wasStripped ? stripDiffMarkers(lfNew, "new") : lfNew;
  if (usesCrlf) {
    result = result.replace(/\n/g, "\r\n");
  }
  return result;
}

/**
 * Strip unified-diff line markers from a multi-line string.
 *
 * `mode === "old"`: keep lines starting with ` ` (context) or `-` (removed); drop `+` lines.
 *                    Strip the leading marker character.
 * `mode === "new"`: keep lines starting with ` ` (context) or `+` (added); drop `-` lines.
 *                    Strip the leading marker character.
 *
 * Returns the input unchanged if it doesn't look like diff (no line starts with `-` or `+`,
 * or any non-empty line starts with a character outside `[ +\-]`).
 */
export function stripDiffMarkers(text: string, mode: "old" | "new"): string {
  const lines = text.split("\n");
  let hasMarker = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    const ch = line[0];
    if (ch !== " " && ch !== "+" && ch !== "-") {
      // Not diff-shaped — bail out.
      return text;
    }
    if (ch === "-" || ch === "+") hasMarker = true;
  }
  if (!hasMarker) return text;

  const keep = mode === "old" ? new Set([" ", "-"]) : new Set([" ", "+"]);
  const out: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      out.push("");
      continue;
    }
    const ch = line[0];
    if (!keep.has(ch)) continue;
    out.push(line.slice(1));
  }
  return out.join("\n");
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

/** Apply many edits in order. */
export async function applyEdits(
  workspaceRoot: string,
  edits: ApplyEdit[],
  fs: FsLike,
  options: { dryRun: boolean },
): Promise<ApplyOutcome[]> {
  const results: ApplyOutcome[] = [];
  for (const e of edits) {
    results.push(await applyEdit(workspaceRoot, e, fs, options));
  }
  return results;
}

// Exposed for tests.
export const __test = { countOccurrences };

// Re-export schema for convenience.
export { ApplyReviewSchema };
// Suppress unused-import warning when only types are re-exported in some callers.
void z;
