import * as vscode from "vscode";
import { buildFixer, buildReviewer, buildTriager, reviewerOwaspEdition } from "./agents.js";
import { readConfig, resolveClients, stripVendor, type ResolvedConfig } from "./config.js";
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { loadChange, renderChangeFrame } from "./openspec/loader.js";
import { validateStrict } from "./openspec/validate.js";
import { getChangeDiff, scopePatchToPaths } from "./openspec/diff.js";
import { createTranscriptWriter, type TranscriptWriter as Transcript } from "./transcript.js";
import { selectConfirmedFindings } from "./triage.js";
import type { FixProposal, Issue, Stage, Triage, Verdict } from "./schemas.js";
import type { LoopOptions } from "./loop.js";
import { ReviewCancelledError, type ToolContext } from "./clients/ChatClient.js";
import {
  createWorkspaceToolset,
  nodeToolFs,
  repositoryIgnorePolicy,
  type WorkspaceToolset,
} from "./tools/workspaceTools.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as fsp from "node:fs/promises";
import {
  applyEdits,
  editsFrom,
  extractFixProposal,
  filterRejectedIssues,
  findLatestTranscript,
  issueFingerprint,
  pruneTranscripts,
  renderFixProposal,
  runBuildGate,
  type ApplyOutcome,
  type EditHost,
  type FsLike,
} from "./applyReview.js";

const PARTICIPANT_ID = "codecrosscheck";
/** Command backing the "apply" buttons; opens chat pre-filled with the slash command. */
const APPLY_COMMAND = "codecrosscheck.runApplyReview";
const SLASH_TO_STAGE: Record<string, Stage[]> = {
  plan: ["plan"],
  code: ["code"],
  execute: ["execute"],
};

/**
 * How a review dialogue ended. `rebutted` is distinct from `approved` on
 * purpose: the reviewer never approved, the worker merely talked its way out
 * of every finding, and only the user can adjudicate that.
 */
type ReviewOutcome = "approved" | "defended" | "rebutted" | "exhausted" | "cancelled" | "failed";

interface CccResultMetadata {
  outcome: ReviewOutcome;
  command: string;
  hasFixProposal: boolean;
  iterations: number;
  [key: string]: unknown;
}

/** Bridge VS Code's CancellationToken to the AbortSignal the engine speaks. */
function toAbortSignal(token: vscode.CancellationToken): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  const sub = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => sub.dispose() };
}

export function activate(context: vscode.ExtensionContext): void {
  const handler: vscode.ChatRequestHandler = async (request, _ctx, stream, token) => {
    const cancellation = toAbortSignal(token);
    try {
      return await routeRequest(request, stream, cancellation.signal);
    } catch (err) {
      if (err instanceof ReviewCancelledError) {
        stream.markdown(`\n\u23f9\ufe0f Cancelled.\n`);
        return { metadata: { outcome: "cancelled", command: request.command ?? "", hasFixProposal: false, iterations: 0 } };
      }
      const message = (err as Error)?.message ?? String(err);
      stream.markdown(`\n\u274c CodeCrossCheck failed: \`${message}\`\n`);
      return {
        errorDetails: { message },
        metadata: { outcome: "failed", command: request.command ?? "", hasFixProposal: false, iterations: 0 },
      };
    } finally {
      cancellation.dispose();
    }
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.followupProvider = { provideFollowups };
  context.subscriptions.push(participant);

  context.subscriptions.push(
    vscode.commands.registerCommand("codecrosscheck.reviewSelection", () =>
      reviewEditorRange(true),
    ),
    vscode.commands.registerCommand("codecrosscheck.reviewActiveFile", () =>
      reviewEditorRange(false),
    ),
    vscode.commands.registerCommand("codecrosscheck.installSkill", () =>
      installDelegationSkill(context),
    ),
    vscode.commands.registerCommand("codecrosscheck.pickModels", () => pickModels()),
    vscode.commands.registerCommand(APPLY_COMMAND, () =>
      vscode.commands.executeCommand("workbench.action.chat.open", {
        query: `@${PARTICIPANT_ID} /apply-review`,
      }),
    ),
  );
}

function provideFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
  const meta = result.metadata as CccResultMetadata | undefined;
  if (!meta) return [];
  const followups: vscode.ChatFollowup[] = [];
  if (meta.hasFixProposal) {
    followups.push({ command: "apply-review", prompt: "", label: "Apply the fix proposal" });
  }
  if (meta.outcome === "exhausted") {
    followups.push({
      command: "review-branch",
      prompt: `max-iters=${Math.min(20, meta.iterations + 4)}`,
      label: "Re-run with more iterations",
    });
  }
  if (meta.outcome === "rebutted") {
    followups.push({
      command: "review-branch",
      prompt: "force-fix-all",
      label: "Override the rebuttals and fix everything",
    });
  }
  return followups;
}

async function routeRequest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  signal: AbortSignal,
): Promise<vscode.ChatResult> {
  const cmd = request.command ?? "";

  if (cmd.startsWith("openspec-")) {
    return handleOpenSpecCommand(cmd, request, stream, signal);
  }
  const cfg = readConfig(vscode.workspace.getConfiguration("codecrosscheck"));

  if (cmd === "review-branch") {
    return handleReviewBranch(request, stream, cfg, signal);
  }
  if (cmd === "apply-review") {
    return handleApplyReview(stream, cfg);
  }

  const stages = SLASH_TO_STAGE[cmd] ?? (["plan", "code", "execute"] as Stage[]);
  const { worker: workerClient, reviewer: reviewerClient, sameModel } = resolveClients(cfg, request.model);

  if (sameModel) {
    stream.markdown(
      `> **Note:** worker and reviewer resolved to the same model (\`${workerClient.modelId}\`). ` +
        `Cross-vendor review is disabled. Pick a different model in the chat picker, ` +
        `or set \`codecrosscheck.useChatPickerWorker\` to \`false\`.\n\n`,
    );
  }

  stream.markdown(
    `Running CodeCrossCheck — worker \`${workerClient.modelId}\`, reviewer \`${reviewerClient.modelId}\`.\n\n`,
  );

  const attached = await readAttachments(request, stream);
  const resolvedPrompt = attached ? `${request.prompt}\n\n${attached}` : request.prompt;

  const transcript = await openTranscript(cfg);
  const onEvent = createPipelineEventHandler(stream, transcript.write);

  const startedAt = Date.now();
  const result = await runPipeline(resolvedPrompt, {
    workerClient,
    reviewerClient,
    stages,
    maxIters: cfg.maxIters,
    sandbox: { timeoutMs: cfg.executeTimeoutMs },
    signal,
    onEvent,
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  const lastStage = result.stages[result.stages.length - 1];
  const lastIter = lastStage?.result.history[lastStage.result.history.length - 1];
  const lastVerdict = lastIter?.verdict;
  const lastArtifact = lastStage?.result.artifact ?? "";
  const totalIters = result.stages.reduce((n, s) => n + s.result.iterations, 0);
  const outcome: ReviewOutcome = result.cancelled
    ? "cancelled"
    : result.approved
      ? "approved"
      : "exhausted";

  transcript.write({ event: "completed", approved: result.approved, cancelled: result.cancelled });

  stream.markdown(`\n---\n\n## Summary\n\n`);
  if (outcome === "cancelled") {
    stream.markdown(
      `\u23f9\ufe0f **Cancelled** after ${totalIters} iteration(s) in ${elapsedSec}s. Partial output below.\n\n`,
    );
  } else if (outcome === "approved") {
    stream.markdown(
      `\u2705 **Approved** after ${totalIters} iteration(s) across ${result.stages.length} stage(s) in ${elapsedSec}s.\n\n`,
    );
  } else {
    const counts = countSeverities(lastVerdict);
    stream.markdown(
      `\u26a0\ufe0f **Did not converge** — iteration cap hit on stage \`${lastStage?.stage}\` after ${totalIters} iteration(s) in ${elapsedSec}s.\n\n` +
        `The last reviewer verdict still flagged ${lastVerdict?.issues.length ?? 0} issue(s) ` +
        `(\ud83d\udd34 ${counts.high} high, \ud83d\udfe1 ${counts.medium} medium, \ud83d\udd35 ${counts.low} low). ` +
        `The best-effort artifact below is the worker's last attempt; treat it as a draft, not an approved result.\n\n` +
        `**Next steps:** raise \`codecrosscheck.maxIters\`, refine the prompt to scope down, or accept the draft and address the remaining issues manually.\n\n`,
    );
  }

  if (lastArtifact) {
    stream.markdown(`### Final artifact (\`${lastStage?.stage}\`)\n\n`);
    stream.markdown(`<details open><summary>${lastArtifact.length} chars</summary>\n\n`);
    stream.markdown(`\`\`\`\n${lastArtifact}\n\`\`\`\n\n</details>\n\n`);
  }

  await flushTranscript(stream, transcript);
  linkTranscript(stream, transcript.path);
  return {
    metadata: { outcome, command: cmd, hasFixProposal: false, iterations: totalIters },
  };
}

export function deactivate(): void {
  // no-op
}

/** Read files the user attached to the chat request so they are not discarded. */
async function readAttachments(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
): Promise<string> {
  const parts: string[] = [];
  const named: string[] = [];
  for (const ref of request.references ?? []) {
    const value = ref.value as unknown;
    let uri: vscode.Uri | undefined;
    let range: vscode.Range | undefined;
    if (value instanceof vscode.Uri) {
      uri = value;
    } else if (value && typeof value === "object" && "uri" in value) {
      uri = (value as { uri: vscode.Uri }).uri;
      range = (value as { range?: vscode.Range }).range;
    }
    if (!uri) continue;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = range ? doc.getText(range) : doc.getText();
      const label = vscode.workspace.asRelativePath(uri) + (range ? `:${range.start.line + 1}-${range.end.line + 1}` : "");
      parts.push(`## Attached: ${label}\n\n\`\`\`\n${text}\n\`\`\``);
      named.push(label);
      stream.reference(uri);
    } catch {
      // Unreadable attachment; skip rather than fail the run.
    }
  }
  if (parts.length === 0) return "";
  stream.markdown(`_Using ${named.length} attached file(s): ${named.map((n) => `\`${n}\``).join(", ")}._\n\n`);
  return ["# Attached context", "", ...parts].join("\n");
}

async function reviewEditorRange(useSelection: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("No active editor.");
    return;
  }
  const text = useSelection && !editor.selection.isEmpty
    ? editor.document.getText(editor.selection)
    : editor.document.getText();

  const cfg = readConfig(vscode.workspace.getConfiguration("codecrosscheck"));
  const { reviewer: reviewerClient } = resolveClients(cfg, undefined);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `CodeCrossCheck: reviewing with ${reviewerClient.modelId}…`, cancellable: true },
    async (_progress, token) => {
      const cancellation = toAbortSignal(token);
      try {
        const verdict = await buildReviewer("code", reviewerClient).judge(text, {
          signal: cancellation.signal,
        });
        showVerdictWebview(verdict);
      } catch (err) {
        if (err instanceof ReviewCancelledError) return;
        void vscode.window.showErrorMessage(`CodeCrossCheck review failed: ${(err as Error).message}`);
      } finally {
        cancellation.dispose();
      }
    },
  );
}

/** Offer the model families this session can actually reach, and store the choice. */
async function pickModels(): Promise<void> {
  const models = await vscode.lm.selectChatModels({});
  if (models.length === 0) {
    void vscode.window.showErrorMessage(
      "No language models are available in this VS Code session. Sign in to Copilot and try again.",
    );
    return;
  }
  const items = Array.from(
    new Map(models.map((m) => [`${m.vendor}/${m.family}`, m])).values(),
  ).map((m) => ({ label: `${m.vendor}/${m.family}`, description: m.name }));

  const worker = await vscode.window.showQuickPick(items, {
    title: "CodeCrossCheck: worker model (the producing LLM)",
    ignoreFocusOut: true,
  });
  if (!worker) return;
  const reviewer = await vscode.window.showQuickPick(
    items.filter((i) => i.label !== worker.label),
    {
      title: "CodeCrossCheck: reviewer model (must differ for cross-vendor review)",
      ignoreFocusOut: true,
    },
  );
  if (!reviewer) return;

  const cfg = vscode.workspace.getConfiguration("codecrosscheck");
  await cfg.update("workerModel", worker.label, vscode.ConfigurationTarget.Global);
  await cfg.update("reviewerModel", reviewer.label, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    `CodeCrossCheck: worker ${worker.label}, reviewer ${reviewer.label}.`,
  );
}

function showVerdictWebview(verdict: Verdict): void {
  const panel = vscode.window.createWebviewPanel(
    "codecrosscheckReview",
    `CodeCrossCheck — ${verdict.verdict}`,
    vscode.ViewColumn.Beside,
    { localResourceRoots: [] },
  );
  const rows = verdict.issues
    .map(
      (it) =>
        `<tr><td>${escapeHtml(it.severity)}</td><td>${escapeHtml(it.where)}</td><td>${escapeHtml(it.why)}</td><td>${escapeHtml(it.suggestion)}</td></tr>`,
    )
    .join("");
  panel.webview.html = `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline';">
  </head><body>
    <h2>Verdict: ${escapeHtml(verdict.verdict)}</h2>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>severity</th><th>where</th><th>why</th><th>suggestion</th></tr>
      ${rows || "<tr><td colspan='4'><em>No issues.</em></td></tr>"}
    </table>
  </body></html>`;
}

function countSeverities(v: Verdict | undefined): { high: number; medium: number; low: number } {
  const counts = { high: 0, medium: 0, low: 0 };
  if (!v) return counts;
  for (const issue of v.issues) {
    if (issue.severity === "high") counts.high++;
    else if (issue.severity === "medium") counts.medium++;
    else counts.low++;
  }
  return counts;
}

/**
 * `/review-branch`: the reviewer judges the branch diff, the worker proposes
 * fixes, and the reviewer re-judges the proposal until it approves, the
 * iteration cap is hit, or every finding has been rebutted.
 */
async function handleReviewBranch(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  cfg: ResolvedConfig,
  signal: AbortSignal,
): Promise<vscode.ChatResult> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  // Parse optional diff-base from prompt (e.g. "diff-base=empty" or "diff-base=origin/develop").
  const diffBaseMatch = request.prompt.match(/\bdiff-base=(\S+)/i);
  const diffBase = diffBaseMatch?.[1];
  const committedOnly = /\bcommitted-only\b/i.test(request.prompt);

  stream.progress(`Computing branch diff${diffBase ? ` vs ${diffBase}` : ""}…`);
  let diff: string;
  let diffDescription: string;
  try {
    const computed = await getChangeDiff({ cwd, baseRef: diffBase, committedOnly });
    diff = computed.patch;
    diffDescription = computed.description;
  } catch (err) {
    const message = `Could not compute branch diff: ${(err as Error).message}`;
    stream.markdown(`❌ ${message}\n\n`);
    return failure(message, "review-branch");
  }
  if (!diff.trim()) {
    stream.markdown(`⚠️ No diff found (${diffDescription}). Nothing to review.\n\n`);
    return failure(`No diff found (${diffDescription}).`, "review-branch");
  }

  const attached = await readAttachments(request, stream);

  // Hard char-budget guard: bail fast with a clear message instead of letting the LM return
  // "Message exceeds token limit" + an empty body that the schema-retry path cannot recover.
  const assembledChars = diff.length + attached.length;
  if (cfg.maxDiffChars > 0 && assembledChars > cfg.maxDiffChars) {
    const message =
      `Branch diff is too large to review in one pass: ${assembledChars.toLocaleString()} chars ` +
      `(cap ${cfg.maxDiffChars.toLocaleString()}).`;
    stream.markdown(
      `❌ ${message} The reviewer model will reject the prompt as ` +
        `exceeding its context window. Options: pass a closer base via \`diff-base=<ref>\` ` +
        `(e.g. \`diff-base=origin/master\`), detach large attachments, split the branch, or raise ` +
        `\`codecrosscheck.reviewBranch.maxDiffChars\` if you have confirmed the picked reviewer model ` +
        `can handle it.\n\n`,
    );
    return failure(message, "review-branch");
  }

  const { worker: workerClient, reviewer: reviewerClient } = resolveClients(cfg, request.model);
  const fixer = buildFixer(workerClient);
  const triager = buildTriager(workerClient);
  const reviewer = buildReviewer("code", reviewerClient);
  const toolset = createWorkspaceToolset({
    root: cwd,
    fs: nodeToolFs(),
    ignore: repositoryIgnorePolicy(cwd),
  });

  const userTask = request.prompt.trim();
  // Recognise user adjudication directive that overrides any worker rebuttals.
  const forceFixAll = /\bforce-fix-all\b/i.test(userTask);
  // Per-invocation override of `codecrosscheck.maxIters`: `max-iters=N`, `maxiters=N` or `iters=N`.
  let maxIters = cfg.maxIters;
  const itersMatch = userTask.match(/\b(?:max-?iters|iters)\s*=\s*(\d{1,2})\b/i);
  if (itersMatch?.[1]) {
    const parsed = Number.parseInt(itersMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
      maxIters = parsed;
    }
  }
  const taskHeader = userTask
    ? `# Reviewer instructions\n${userTask}`
    : `# Reviewer instructions\nReview this branch diff for OWASP issues, dead code, missing tests, and OpenSpec drift. Cite file:line for each issue.`;
  const diffBody = `\`\`\`diff\n${diff}\n\`\`\``;
  const diffBlock = `# Branch diff (${diffDescription})\n\n${diffBody}`;
  const attachedBlock = attached ? `\n\n${attached}` : "";

  const transcript = await openTranscript(cfg);
  transcript.write({
    event: "review-branch-start",
    reviewerId: reviewer.modelId,
    workerId: fixer.modelId,
    owaspEdition: reviewerOwaspEdition(),
    diffDescription,
    diffChars: diff.length,
    maxIters,
  });

  stream.markdown(
    `\u23f3 Branch review: worker \`${fixer.modelId}\` \u2194 reviewer \`${reviewer.modelId}\`\n\n` +
      `Comparing **${diffDescription}** \u00b7 diff \`${diff.length.toLocaleString()}\` chars \u00b7 cap \`${maxIters}\` iterations\n\n`,
  );

  const startedAt = Date.now();
  let verdict: Verdict | undefined;
  let lastProposal: FixProposal | undefined;
  let lastArtifact = "";
  let iter = 0;
  let outcome: ReviewOutcome = "exhausted";

  // Findings the worker has already rebutted with `disagree`, fingerprinted so
  // a restatement in a later round can be dropped. Without this the reviewer
  // keeps re-flagging, the worker keeps rebutting, and the loop burns
  // iterations on a question only the user can settle.
  const rejectedFingerprints = new Set<string>();
  const cumulativeDisagreements: Array<{ id: number; heading: string; rebuttal: string }> = [];

  const toolsFor = (agent: string): ToolContext =>
    makeToolContext(toolset, stream, transcript, agent, {
      maxCalls: cfg.toolMaxCalls,
      deadlineMs: cfg.toolDeadlineMs,
    });

  // ---- Iteration 1: reviewer reads the raw diff. ----
  iter = 1;
  stream.markdown(`---\n\n### Iteration ${iter} / ${maxIters} \u2014 initial review\n\n`);

  const reviewerPrompt = `${taskHeader}\n\n${diffBlock}${attachedBlock}`;
  const preflight = await tokenPreflight(cfg, reviewerPrompt);
  if (preflight) {
    stream.markdown(
      `\u274c Reviewer prompt is too large for \`${reviewer.modelId}\`: \`${preflight.tokens.toLocaleString()}\` tokens ` +
        `vs budget \`${preflight.budget.toLocaleString()}\` (90% of maxInputTokens \`${preflight.max.toLocaleString()}\`). ` +
        `Pass a closer \`diff-base=<ref>\`, pick a larger reviewer model via \`codecrosscheck.reviewerModel\`, ` +
        `or split the branch.\n\n`,
    );
    return failure(`Reviewer prompt exceeds the context budget for ${reviewer.modelId}.`, "review-branch");
  }

  stream.progress(`Reviewer \`${reviewer.modelId}\` reading diff\u2026`);
  try {
    verdict = await reviewer.judge(reviewerPrompt, { signal });
  } catch (err) {
    if (err instanceof ReviewCancelledError) throw err;
    const message = `Reviewer call failed: ${(err as Error).message}`;
    stream.markdown(`\u274c ${message}\n\n`);
    return failure(message, "review-branch");
  }
  renderVerdict(stream, verdict);
  transcript.write({ event: "review-branch-iter", iteration: iter, role: "reviewer", reviewerId: reviewer.modelId, verdict });

  // ---- Iterations 2..N: worker proposes fixes, reviewer re-judges. ----
  while (iter < maxIters && verdict.verdict !== "approve") {
    if (signal.aborted) {
      outcome = "cancelled";
      break;
    }
    iter++;
    stream.markdown(`---\n\n### Iteration ${iter} / ${maxIters} \u2014 worker proposes fixes\n\n`);

    // Adjudicate before drafting. A worker told to fix N issues will fix N
    // issues, including the ones that are wrong.
    let fixableVerdict = verdict;
    if (!forceFixAll) {
      stream.progress(`Worker \`${triager.modelId}\` checking whether the findings are real\u2026`);
      let triage: Triage | undefined;
      try {
        triage = await triager.triage(buildTriageInput({ verdict, diffDescription }), {
          signal,
          tools: toolsFor("triager"),
        });
      } catch (err) {
        if (err instanceof ReviewCancelledError) {
          outcome = "cancelled";
          break;
        }
        // Triage is an extra safety net, not a gate: if it fails, fall through
        // to the old behaviour rather than losing the run.
        stream.markdown(`\u26a0\ufe0f Triage unavailable (\`${(err as Error).message}\`); drafting fixes for all findings.\n\n`);
      }

      if (triage) {
        transcript.write({ event: "review-branch-triage", iteration: iter, triagerId: triager.modelId, entries: triage.entries });
        const confirmed = renderTriage(stream, verdict, triage);
        if (confirmed.length === 0) {
          outcome = "defended";
          verdict = { verdict: "approve", issues: [] };
          break;
        }
        fixableVerdict = { verdict: verdict.verdict, issues: confirmed };
      }
    }

    stream.progress(`Worker \`${fixer.modelId}\` drafting fixes for ${fixableVerdict.issues.length} issue(s)\u2026`);
    const fixerInput = buildFixerInput({
      taskHeader,
      diffBlock,
      currentVerdict: fixableVerdict,
      priorFixProposal: lastArtifact,
      round: iter - 1,
      forceFixAll,
    });
    try {
      lastProposal = await fixer.propose(fixerInput, { signal, tools: toolsFor("fixer") });
    } catch (err) {
      if (err instanceof ReviewCancelledError) {
        outcome = "cancelled";
        break;
      }
      stream.markdown(`\u274c Worker call failed: \`${(err as Error).message}\`\n\n`);
      break;
    }
    lastArtifact = renderFixProposal(lastProposal, fixableVerdict.issues);
    transcript.write({
      event: "review-branch-iter",
      iteration: iter,
      role: "worker",
      workerId: fixer.modelId,
      artifact: lastArtifact,
      proposal: lastProposal,
    });
    renderProposal(stream, lastProposal, fixableVerdict.issues);

    // Capture this round's rebuttals against the verdict that was fed in, so
    // the next reviewer pass cannot send the same finding back through the
    // loop. `force-fix-all` opts out.
    if (!forceFixAll) {
      for (const fix of lastProposal.fixes) {
        if (fix.status !== "disagree") continue;
        const issue = fixableVerdict.issues[fix.findingId - 1];
        if (!issue) continue;
        const fp = issueFingerprint(issue);
        if (!rejectedFingerprints.has(fp)) {
          rejectedFingerprints.add(fp);
          cumulativeDisagreements.push({
            id: fix.findingId,
            heading: issue.where,
            rebuttal: fix.explanation,
          });
        }
      }
    }

    stream.markdown(`#### Reviewer re-judging\n\n`);
    stream.progress(`Reviewer \`${reviewer.modelId}\` checking fixes\u2026`);
    // The reviewer is judging a proposal, not re-reading the branch: send only
    // the files the proposal's own edits touch.
    const scoped = scopePatchToPaths(diff, Array.from(new Set(editsFrom(lastProposal).map((e) => e.path))));
    const reviewArtifact = buildRereviewInput({
      taskHeader,
      diffDescription,
      diffBody: `\`\`\`diff\n${scoped.patch}\n\`\`\``,
      omittedFiles: scoped.omitted,
      priorVerdict: verdict,
      fixProposal: lastArtifact,
    });
    try {
      verdict = await reviewer.judge(reviewArtifact, { signal });
    } catch (err) {
      if (err instanceof ReviewCancelledError) {
        outcome = "cancelled";
        break;
      }
      stream.markdown(`\u274c Reviewer call failed: \`${(err as Error).message}\`\n\n`);
      break;
    }

    // Drop findings the worker already rebutted. The reviewer is stateless and
    // tends to restate the same concern; without this the loop ping-pongs.
    const filtered = filterRejectedIssues(verdict, rejectedFingerprints);
    if (filtered.dropped > 0) {
      verdict = filtered.verdict;
      stream.markdown(
        `_Skipped ${filtered.dropped} finding(s) the worker already rebutted in a prior round. ` +
          `Use \`force-fix-all\` on a future run to override._\n\n`,
      );
    }

    renderVerdict(stream, verdict);
    transcript.write({
      event: "review-branch-iter",
      iteration: iter,
      role: "reviewer",
      reviewerId: reviewer.modelId,
      verdict,
      diffScoped: scoped.scoped,
      diffChars: scoped.patch.length,
      filesIncluded: scoped.included,
      filesOmitted: scoped.omitted,
    });

    if (filtered.emptiedBySuppression) {
      // Every remaining finding was suppressed by a rebuttal. The reviewer did
      // NOT approve — only the user can settle this — so stop here and say so.
      outcome = "rebutted";
      break;
    }
  }

  if (outcome === "exhausted" && verdict?.verdict === "approve") outcome = "approved";
  if (signal.aborted) outcome = "cancelled";

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const counts = countSeverities(verdict);

  stream.markdown(`---\n\n## Summary\n\n`);
  if (outcome === "approved") {
    stream.markdown(
      `\u2705 **Approved** after ${iter} iteration(s) in ${elapsedSec}s. The reviewer is satisfied with the worker's fix proposal.\n\n`,
    );
  } else if (outcome === "rebutted") {
    stream.markdown(
      `\ud83e\udd1d **Stalled on disagreement** after ${iter} iteration(s) in ${elapsedSec}s. ` +
        `**The reviewer did not approve.** The loop stopped because the worker rebutted every ` +
        `remaining finding, and a rebuttal is not a fix \u2014 only you can settle it. ` +
        `Read the ${cumulativeDisagreements.length} rebuttal(s) below and either accept them or ` +
        `re-run with \`force-fix-all\`.\n\n`,
    );
  } else if (outcome === "defended") {
    stream.markdown(
      `\ud83d\udee1\ufe0f **Findings did not survive triage** after ${iter} iteration(s) in ${elapsedSec}s. ` +
        `The worker examined every remaining finding against the current source and could not ` +
        `confirm any of them, so nothing was drafted and nothing is proposed for application. ` +
        `The evidence for each rejection is above \u2014 read it rather than trusting it. ` +
        `If you disagree, re-run with \`force-fix-all\` to draft fixes regardless.\n\n`,
    );
  } else if (outcome === "cancelled") {
    stream.markdown(`\u23f9\ufe0f **Cancelled** after ${iter} iteration(s) in ${elapsedSec}s. Partial output below.\n\n`);
  } else {
    stream.markdown(
      `\u26a0\ufe0f **Did not converge** after ${iter} iteration(s) in ${elapsedSec}s. ` +
        `Reviewer still flags ${verdict?.issues.length ?? 0} issue(s) ` +
        `(\ud83d\udd34 ${counts.high} high, \ud83d\udfe1 ${counts.medium} medium, \ud83d\udd35 ${counts.low} low). ` +
        `Note: the residual findings target the **proposal**, not the original branch \u2014 the proposal itself may still contain applicable patches.\n\n`,
    );
  }

  if (lastProposal) {
    const editCount = editsFrom(lastProposal).length;
    stream.markdown(
      `**Next:** apply the ${editCount} edit(s) in the fix proposal below. ` +
        (outcome === "approved"
          ? `The reviewer is satisfied; once applied, run \`git diff\` and commit.\n\n`
          : outcome === "defended"
            ? `It addresses findings confirmed in an earlier round; the findings raised since were rejected.\n\n`
            : `Then re-run \`/review-branch\` to address any residual findings, raise \`codecrosscheck.maxIters\` for more rounds, or scope the prompt down.\n\n`),
    );
    stream.button({ command: APPLY_COMMAND, title: "Apply this fix proposal", arguments: [] });
    stream.markdown(`### Final fix proposal\n\n<details${outcome === "approved" ? " open" : ""}><summary>${editCount} edit(s)</summary>\n\n`);
    stream.markdown(`\`\`\`markdown\n${lastArtifact}\n\`\`\`\n\n</details>\n\n`);
  } else if (outcome !== "approved" && outcome !== "defended") {
    stream.markdown(
      `**Next steps:** raise \`codecrosscheck.maxIters\`, scope the prompt, or address the findings manually.\n\n`,
    );
  }

  // Surface worker rebuttals so the user can adjudicate. We use the cumulative
  // list because the loop drops rebutted findings from later verdicts, so by
  // the time we exit they may not appear in the final fix proposal at all.
  if (cumulativeDisagreements.length > 0) {
    stream.markdown(`### \ud83e\udd14 ${cumulativeDisagreements.length} worker disagreement(s) pending your decision\n\n`);
    stream.markdown(
      "The worker rebutted the following reviewer finding(s) instead of fixing them. " +
        "**Review each rebuttal below and decide.**\n\n",
    );
    for (const d of cumulativeDisagreements) {
      stream.markdown(`#### ${d.id}. ${d.heading}\n\n`);
      stream.markdown(`> ${d.rebuttal.replace(/\n/g, "\n> ")}\n\n`);
    }
    stream.markdown(
      "**To proceed:**\n\n" +
        "- **Accept the rebuttals** (you agree the worker is right): run `/apply-review` \u2014 the rebutted findings simply have no edits, so nothing is applied for them.\n" +
        "- **Override the rebuttals** (force the worker to fix anyway): re-run `/review-branch` with `force-fix-all` in the prompt. The fixer will be told to produce concrete fixes for every finding and may not rebut.\n\n",
    );
  }

  // Surface findings the worker itself marked as neither fixed nor rebutted.
  const unaddressed = lastProposal?.fixes.filter((f) => f.status === "unaddressed") ?? [];
  if (unaddressed.length > 0) {
    stream.markdown(`### \ud83d\udeab ${unaddressed.length} finding(s) the worker could not produce a patch for\n\n`);
    stream.markdown(
      "The worker marked these `unaddressed`: it could neither fix nor rebut them. " +
        "No edits will be applied for them.\n\n",
    );
    for (const f of unaddressed) {
      stream.markdown(`- **Finding ${f.findingId}** \u2014 ${escapeHtml(f.explanation)}\n`);
    }
    stream.markdown(
      "\nRe-run with `force-fix-all` to require a concrete fix, or address them by hand.\n\n",
    );
  }

  transcript.write({
    event: "review-branch-done",
    approved: outcome === "approved",
    outcome,
    iterations: iter,
    elapsedMs: Date.now() - startedAt,
  });
  await flushTranscript(stream, transcript);
  linkTranscript(stream, transcript.path);
  return {
    metadata: {
      outcome,
      command: "review-branch",
      hasFixProposal: editsFrom(lastProposal ?? { summary: "", fixes: [] }).length > 0,
      iterations: iter,
    },
  };
}

function failure(message: string, command: string): vscode.ChatResult {
  return {
    errorDetails: { message },
    metadata: { outcome: "failed", command, hasFixProposal: false, iterations: 0 },
  };
}

/**
 * Best-effort token preflight on the reviewer model. Catches a diff that is
 * under `maxDiffChars` but still too large for a smaller reviewer. Returns
 * null when the prompt fits or the model does not expose token counting.
 */
async function tokenPreflight(
  cfg: ResolvedConfig,
  prompt: string,
): Promise<{ tokens: number; budget: number; max: number } | null> {
  try {
    const candidates = await vscode.lm.selectChatModels({ family: stripVendor(cfg.reviewerModel) });
    const model = candidates[0];
    if (!model || typeof model.maxInputTokens !== "number" || model.maxInputTokens <= 0) return null;
    const tokens = await model.countTokens(prompt);
    // Reserve ~10% of the window for the response.
    const budget = Math.floor(model.maxInputTokens * 0.9);
    return tokens > budget ? { tokens, budget, max: model.maxInputTokens } : null;
  } catch {
    // countTokens is best-effort; if it throws, let the call proceed.
    return null;
  }
}

/**
 * /apply-review handler: read the latest review transcript and apply the edits
 * the worker already produced. It is the user-confirmation checkpoint of the
 * /review-branch -> /apply-review -> git diff loop, and calls no model.
 */
async function handleApplyReview(
  stream: vscode.ChatResponseStream,
  cfg: ResolvedConfig,
): Promise<vscode.ChatResult> {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    stream.markdown("\u274c No workspace folder open.\n");
    return failure("No workspace folder open.", "apply-review");
  }
  const transcriptsDir = path.join(ws, ".codecrosscheck", "runs");
  const nodeFs = nodeFsLike();

  stream.progress("Locating latest review transcript\u2026");
  const transcriptPath = await findLatestTranscript(transcriptsDir, nodeFs);
  if (!transcriptPath) {
    stream.markdown(
      "\u274c No review transcript found. Run `@codecrosscheck /review-branch` first to produce a fix proposal, then run `/apply-review`.\n",
    );
    return failure("No review transcript found.", "apply-review");
  }
  const stored = await extractFixProposal(transcriptPath, nodeFs);
  if (!stored) {
    stream.markdown(
      `\u274c Transcript [${path.basename(transcriptPath)}](${vscode.Uri.file(transcriptPath).toString()}) ` +
        "has no worker fix proposal to apply. Re-run `/review-branch`.\n",
    );
    return failure("Transcript has no worker fix proposal.", "apply-review");
  }

  // Transcripts written before structured proposals carry only Markdown. There
  // is no longer a model call that turns prose into edits, so say so plainly
  // rather than applying nothing and calling it success.
  if (!stored.proposal) {
    stream.markdown(
      `\u26a0\ufe0f [${path.basename(transcriptPath)}](${vscode.Uri.file(transcriptPath).toString()}) ` +
        `predates structured fix proposals, so it carries prose rather than edits. ` +
        `Re-run \`/review-branch\` to produce an applicable proposal. The stored proposal is below.\n\n`,
    );
    stream.markdown(`<details><summary>${stored.artifact.length} chars</summary>\n\n\`\`\`markdown\n${stored.artifact}\n\`\`\`\n\n</details>\n\n`);
    return failure("Transcript predates structured fix proposals.", "apply-review");
  }

  const edits = editsFrom(stored.proposal);
  const unaddressed = stored.proposal.fixes.filter((f) => f.status !== "fixed");
  stream.markdown(
    `\ud83d\udcc4 Applying fix proposal from [${path.basename(transcriptPath)}](${vscode.Uri.file(transcriptPath).toString()}) ` +
      `(iter ${stored.iteration}, ${edits.length} edit(s)).\n\n`,
  );
  if (unaddressed.length > 0) {
    stream.markdown(
      `_${unaddressed.length} finding(s) carry no edits (${unaddressed.map((f) => `${f.findingId}: ${f.status}`).join(", ")})._\n\n`,
    );
  }

  const applyLogPath = transcriptPath.replace(/\.jsonl$/i, "-apply.json");

  if (edits.length === 0) {
    stream.markdown("\u26a0\ufe0f The proposal contains zero edits. Nothing to apply.\n");
    await nodeFs.writeFile(
      applyLogPath,
      JSON.stringify({ transcriptPath, iteration: stored.iteration, edits, outcomes: [] }, null, 2),
    );
    stream.markdown(`\ud83d\udcc4 Debug log: [${path.basename(applyLogPath)}](${vscode.Uri.file(applyLogPath).toString()})\n`);
    return { metadata: { outcome: "exhausted", command: "apply-review", hasFixProposal: true, iterations: 0 } };
  }
  stream.markdown(`Applying **${edits.length}** edit(s)${cfg.dryRun ? " (dry-run mode)" : ""}.\n\n`);

  const outcomes: ApplyOutcome[] = await applyEdits(ws, edits, nodeFs, {
    dryRun: cfg.dryRun,
    host: workspaceEditHost(),
  });
  renderApplyOutcomes(stream, outcomes);

  await nodeFs.writeFile(
    applyLogPath,
    JSON.stringify({ transcriptPath, iteration: stored.iteration, edits, outcomes }, null, 2),
  );

  const appliedCount = outcomes.filter((o) => o.status === "applied").length;
  const dryCount = outcomes.filter((o) => o.status === "dry-run").length;
  const skippedCount = outcomes.filter((o) => o.status === "skipped").length;

  stream.markdown(`---\n\n## Summary\n\n`);
  if (cfg.dryRun) {
    stream.markdown(
      `\ud83d\udd0d **Dry run** \u2014 would apply ${dryCount} edit(s), skip ${skippedCount}. ` +
        "Set `codecrosscheck.applyReview.dryRun` to `false` to write changes.\n\n",
    );
  } else {
    stream.markdown(
      `\u2705 Applied **${appliedCount}** edit(s); skipped **${skippedCount}**. Undo reverts the whole batch.\n\n` +
        "**Next steps:** run `git diff` to inspect, then commit. Re-run `/review-branch` to verify findings are closed.\n\n",
    );
  }
  stream.markdown(`\ud83d\udcc4 Debug log: [${path.basename(applyLogPath)}](${vscode.Uri.file(applyLogPath).toString()})\n\n`);

  const wantsCommands = !cfg.dryRun && appliedCount > 0 && (cfg.testCommand || cfg.buildCommand);
  if (wantsCommands && !vscode.workspace.isTrusted) {
    stream.markdown(
      "\u26a0\ufe0f Skipped the configured build and test commands: running commands requires a trusted workspace. " +
        "Use **Workspaces: Manage Workspace Trust** if you trust this folder.\n\n",
    );
  } else if (wantsCommands) {
    if (cfg.testCommand) {
      const terminalName = "CodeCrossCheck: apply-review tests";
      let term = vscode.window.terminals.find((t) => t.name === terminalName);
      if (!term) term = vscode.window.createTerminal({ name: terminalName, cwd: ws });
      term.show(false);
      term.sendText(cfg.testCommand, true);
      stream.markdown(`\u25b6\ufe0f Started \`${cfg.testCommand}\` in terminal **${terminalName}**.\n`);
    }

    // Build gate: run synchronously, capture exit code + tail of output, and
    // surface a clear pass/fail block so the next /review-branch round can see
    // what broke.
    if (cfg.buildCommand) {
      stream.markdown(`---\n\n## Build gate\n\n`);
      stream.progress(`Running \`${cfg.buildCommand}\`\u2026`);
      const result = await runBuildGate({ cwd: ws, command: cfg.buildCommand, timeoutMs: cfg.buildTimeoutMs });
      const elapsedSec = (result.durationMs / 1000).toFixed(1);
      if (result.exitCode === 0) {
        stream.markdown(`\u2705 \`${cfg.buildCommand}\` exited 0 in ${elapsedSec}s. Edits compile.\n\n`);
      } else {
        const reason = result.timedOut
          ? `timed out after ${elapsedSec}s`
          : `exited with code ${result.exitCode ?? "unknown"} in ${elapsedSec}s`;
        stream.markdown(
          `\u274c \`${cfg.buildCommand}\` ${reason}. The applied edits do not build.\n\n` +
            "**Likely cause:** the worker referenced symbols (types, methods, overloads) " +
            "that aren't in the current source \u2014 e.g. a helper class that was supposed " +
            "to come from an earlier round but wasn't applied. Re-run `/review-branch` " +
            "with the build output below pasted as additional reviewer instructions, " +
            "or undo to revert the batch.\n\n",
        );
        stream.markdown(
          `<details open><summary>Build output (${result.output.length} chars${result.truncated ? ", truncated" : ""})</summary>\n\n` +
            "```\n" + result.output + "\n```\n\n</details>\n\n",
        );
      }
    }
  }

  return {
    metadata: {
      outcome: appliedCount > 0 || cfg.dryRun ? "approved" : "exhausted",
      command: "apply-review",
      hasFixProposal: false,
      iterations: 0,
    },
  };
}

/**
 * Applies the batch through `vscode.workspace.applyEdit`, so it lands as a
 * single undo step and files with unsaved changes are edited in the document
 * rather than overwritten on disk.
 */
function workspaceEditHost(): EditHost {
  return {
    async commit(writes) {
      const edit = new vscode.WorkspaceEdit();
      for (const w of writes) {
        const uri = vscode.Uri.file(w.path);
        let exists = true;
        try {
          await vscode.workspace.fs.stat(uri);
        } catch {
          exists = false;
        }
        if (!exists) {
          edit.createFile(uri, { contents: Buffer.from(w.content, "utf8"), ignoreIfExists: true });
          continue;
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        const whole = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length),
        );
        edit.replace(uri, whole, w.content);
      }
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) throw new Error("VS Code refused to apply the workspace edit.");
    },
  };
}

function renderApplyOutcomes(stream: vscode.ChatResponseStream, outcomes: ApplyOutcome[]): void {
  for (const o of outcomes) {
    const icon =
      o.status === "applied" ? "\u2705" : o.status === "dry-run" ? "\ud83d\udd0d" : "\u26a0\ufe0f";
    const tail = o.reason ? ` \u2014 ${o.reason}` : "";
    const verb = o.status === "dry-run" ? "would apply" : o.status;
    stream.markdown(`- ${icon} \`${o.path}\` \u2014 ${verb}${tail}\n  - **why:** ${o.why}\n`);
  }
  stream.markdown("\n");
}

function buildFixerInput(args: {
  taskHeader: string;
  diffBlock: string;
  currentVerdict: Verdict;
  priorFixProposal: string;
  round: number;
  forceFixAll?: boolean;
}): string {
  const issues = args.currentVerdict.issues
    .map(
      (it, idx) =>
        `${idx + 1}. [${it.severity}] ${it.where}\n   why: ${it.why}\n   suggestion: ${it.suggestion}`,
    )
    .join("\n");
  const priorBlock = args.priorFixProposal
    ? `\n\n# Your prior fix proposal (reviewer was not satisfied)\n\n${args.priorFixProposal}`
    : "";
  const overrideBlock = args.forceFixAll
    ? "\n\n# User override\n\nThe user has explicitly overridden any rebuttals. You MUST produce a concrete fix for every reviewer finding above. `disagree` is not available in this round."
    : "";
  return [
    args.taskHeader,
    "",
    args.diffBlock,
    "",
    "# Reviewer findings to address",
    issues,
    priorBlock,
    overrideBlock,
    "",
    `Produce fix proposal round ${args.round + 1}. Address every finding above.`,
  ].join("\n");
}

function buildTriageInput(args: { verdict: Verdict; diffDescription: string }): string {
  const findings = args.verdict.issues
    .map(
      (it, idx) =>
        `## Finding ${idx + 1}\n- severity: ${it.severity}\n- where: ${it.where}\n- claim: ${it.why}\n- proposed remedy: ${it.suggestion}`,
    )
    .join("\n\n");
  return [
    "# Findings to judge",
    "",
    `A reviewer produced these findings against ${args.diffDescription}.`,
    "Judge each one. You are judging the CLAIM, not the proposed remedy.",
    "Read whatever source you need through the tools before deciding.",
    "",
    findings,
  ].join("\n");
}

/** Renders each triage entry and returns the findings that survived. */
function renderTriage(stream: vscode.ChatResponseStream, verdict: Verdict, triage: Triage): Issue[] {
  const { confirmed, statuses } = selectConfirmedFindings(verdict, triage);
  const icons = { confirmed: "\u2705", rejected: "\u274c", uncertain: "\u2753" } as const;

  stream.markdown(`#### Triage \u2014 are these findings real?\n\n`);
  statuses.forEach((s, idx) => {
    stream.markdown(
      `${icons[s.status]} **${idx + 1}. ${s.status}** — \`${escapeHtml(s.issue.where)}\`\n\n` +
        `> ${escapeHtml(s.evidence).replace(/\n/g, "\n> ")}\n\n`,
    );
  });

  const dropped = verdict.issues.length - confirmed.length;
  stream.markdown(
    dropped > 0
      ? `_${confirmed.length} of ${verdict.issues.length} finding(s) confirmed; ${dropped} not drafted against. Re-run with \`force-fix-all\` to override._\n\n`
      : `_All ${confirmed.length} finding(s) confirmed._\n\n`,
  );
  return confirmed;
}

function formatVerdictForRereview(v: Verdict): string {
  return v.issues
    .map(
      (it, idx) =>
        `${idx + 1}. [${it.severity}] ${it.where}\n   why: ${it.why}\n   suggestion: ${it.suggestion}`,
    )
    .join("\n");
}

/** The reviewer judges the *proposal*, not the diff — the diff is the before state. */
function buildRereviewInput(args: {
  taskHeader: string;
  diffDescription: string;
  diffBody: string;
  omittedFiles: number;
  priorVerdict: Verdict;
  fixProposal: string;
}): string {
  const scopeNote =
    args.omittedFiles > 0
      ? ` \u2014 scoped to the files your findings cited; ${args.omittedFiles} further changed file(s) are omitted and are not under review`
      : "";
  return [
    "# Re-review: judge a proposed fix",
    "",
    "You previously reviewed this branch and produced findings. The author has responded with a fix proposal.",
    "Your job is to judge **whether the proposal, IF APPLIED, would resolve every prior finding without introducing new issues**.",
    "",
    "# Critical instructions",
    "",
    "- The diff below is the **BEFORE** state. The fix proposal describes what would change.",
    "- Do **NOT** re-flag a finding just because the diff still shows the original problem. The diff is unchanged by design — the proposal is what would change. You are evaluating the proposal, not the diff.",
    "- For each prior finding, decide: does the proposal address it adequately? If yes, do **not** list it again. If no (proposal missing, vague, or technically wrong), list it again and say specifically what is missing or wrong.",
    "- You MAY raise new findings only if the **proposal itself** introduces them (e.g., proposed code contains a clear bug, breaks an API, or misnames something visible in the diff).",
    "- `approve` when every prior finding is adequately addressed by the proposal.",
    "",
    args.taskHeader,
    "",
    `# Branch diff — BEFORE state (${args.diffDescription})${scopeNote}`,
    "",
    args.diffBody,
    "",
    "# Prior findings",
    "",
    formatVerdictForRereview(args.priorVerdict),
    "",
    "# Worker's fix proposal (proposed AFTER state)",
    "",
    args.fixProposal,
  ].join("\n");
}

function renderVerdict(stream: vscode.ChatResponseStream, v: Verdict): void {
  const counts = countSeverities(v);
  const total = v.issues.length;
  const icon = v.verdict === "approve" ? "\u2705" : "\u270f\ufe0f";
  const headline = total === 0
    ? "No issues"
    : `${total} finding(s): \ud83d\udd34 ${counts.high} high, \ud83d\udfe1 ${counts.medium} medium, \ud83d\udd35 ${counts.low} low`;
  stream.markdown(`${icon} **Verdict: \`${v.verdict}\`** \u2014 ${headline}\n\n`);
  if (total === 0) return;
  for (const sev of ["high", "medium", "low"] as const) {
    const issues = v.issues.filter((i) => i.severity === sev);
    if (issues.length === 0) continue;
    const sevIcon = sev === "high" ? "\ud83d\udd34" : sev === "medium" ? "\ud83d\udfe1" : "\ud83d\udd35";
    stream.markdown(`**${sevIcon} ${sev} (${issues.length})**\n\n`);
    for (const issue of issues) {
      stream.markdown(
        `- \`${issue.where}\`\n  - **why:** ${issue.why}\n  - **suggestion:** ${issue.suggestion}\n`,
      );
    }
    stream.markdown(`\n`);
  }
}

function renderProposal(stream: vscode.ChatResponseStream, proposal: FixProposal, issues: Issue[]): void {
  const icons = { fixed: "\u2705", disagree: "\ud83e\udd1d", unaddressed: "\ud83d\udeab" } as const;
  const counts = { fixed: 0, disagree: 0, unaddressed: 0 };
  for (const fix of proposal.fixes) counts[fix.status]++;
  stream.markdown(
    `${counts.fixed} fixed \u00b7 ${counts.disagree} disagreed \u00b7 ${counts.unaddressed} unaddressed\n\n` +
      `> ${escapeHtml(proposal.summary).replace(/\n/g, "\n> ")}\n\n`,
  );
  for (const fix of proposal.fixes) {
    const where = issues[fix.findingId - 1]?.where ?? `finding ${fix.findingId}`;
    stream.markdown(
      `${icons[fix.status]} **${fix.findingId}. ${fix.status}** \u2014 \`${escapeHtml(where)}\`\n\n` +
        `> ${escapeHtml(fix.explanation).replace(/\n/g, "\n> ")}\n\n`,
    );
    for (const edit of fix.edits) {
      stream.markdown(`  - \`${edit.path}\` \u2014 ${escapeHtml(edit.why)}\n`);
    }
    if (fix.edits.length > 0) stream.markdown("\n");
  }
}

/**
 * Grant an agent the workspace toolset for one turn, streaming each call to the
 * user and recording it in the transcript. A tool call the user cannot see is a
 * file read they did not authorise.
 */
function makeToolContext(
  toolset: WorkspaceToolset,
  stream: vscode.ChatResponseStream,
  transcript: Transcript,
  agent: string,
  limits: { maxCalls: number; deadlineMs: number },
): ToolContext {
  return {
    specs: toolset.specs,
    maxCalls: limits.maxCalls,
    deadlineMs: limits.deadlineMs,
    invoke: (call) => toolset.invoke(call),
    onCall(call, result) {
      const detail = summariseToolInput(call.input);
      stream.progress(`${agent}: ${call.name}${detail ? ` ${detail}` : ""}`);
      transcript.write({
        event: "tool-call",
        agent,
        tool: call.name,
        input: call.input,
        isError: result.isError === true,
        resultChars: result.content.length,
      });
    },
    onFinish(info) {
      transcript.write({ event: "tool-loop-done", agent, ...info });
      if (info.stop !== "final") {
        stream.markdown(
          `\u26a0\ufe0f \`${agent}\` hit the tool ${info.stop === "budget-exhausted" ? "call budget" : "time limit"} ` +
            `after ${info.callCount} call(s) and had to answer from what it had. ` +
            `Raise \`codecrosscheck.tools.${info.stop === "budget-exhausted" ? "maxCalls" : "deadlineMs"}\` if this recurs.\n\n`,
        );
      }
    },
  };
}

function summariseToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as { path?: unknown; query?: unknown };
  if (typeof obj.path === "string") return `\`${obj.path}\``;
  if (typeof obj.query === "string") return `\`${obj.query}\``;
  return "";
}


/**
 * Shared chat-stream renderer for `PipelineEvent`s. Used by both the default
 * staged-pipeline handler (`/plan`, `/code`, `/execute`) and the OpenSpec
 * review handler so both surfaces emit identical iteration progress.
 */
function createPipelineEventHandler(
  stream: vscode.ChatResponseStream,
  writeEvent: (event: Record<string, unknown>) => void,
): (ev: PipelineEvent) => void {
  return (ev) => {
    writeEvent({ event: ev.type, ...ev });
    if (ev.type === "stage-start") {
      stream.markdown(
        `\n## Stage: \`${ev.stage}\`\n\nWorker \`${ev.workerId}\` \u2192 reviewer \`${ev.reviewerId}\`.\n\n`,
      );
    } else if (ev.type === "iteration-start") {
      stream.markdown(`---\n\n**Iteration ${ev.iteration} / ${ev.maxIters}**\n\n`);
    } else if (ev.type === "worker-start") {
      stream.progress(`${ev.stage} \u00b7 iteration ${ev.iteration} \u00b7 worker \`${ev.modelId}\` thinking\u2026`);
    } else if (ev.type === "worker") {
      stream.markdown(`#### \ud83d\udcdd Worker (\`${ev.modelId}\`) produced\n\n`);
      const trimmed = ev.artifact.length > 4000
        ? ev.artifact.slice(0, 4000) + "\n\n\u2026 _(truncated for chat; full text in transcript)_"
        : ev.artifact;
      stream.markdown(`\`\`\`\n${trimmed}\n\`\`\`\n\n`);
    } else if (ev.type === "reviewer-start") {
      stream.progress(`${ev.stage} \u00b7 iteration ${ev.iteration} \u00b7 reviewer \`${ev.modelId}\` judging\u2026`);
    } else if (ev.type === "verdict") {
      const v = ev.verdict;
      const icon = v.verdict === "approve" ? "\u2705" : "\u274c";
      const sourceTag = ev.source === "validator" ? " _(via openspec validate)_" : "";
      stream.markdown(
        `#### ${icon} Reviewer (\`${ev.modelId}\`)${sourceTag} \u2192 **${v.verdict.toUpperCase()}**\n\n`,
      );
      if (v.issues.length > 0) {
        for (const issue of v.issues) {
          const sevIcon =
            issue.severity === "high" ? "\ud83d\udd34" :
            issue.severity === "medium" ? "\ud83d\udfe1" : "\ud83d\udd35";
          stream.markdown(
            `- ${sevIcon} **${issue.severity}** \u00b7 \`${issue.where}\`\n  - **why:** ${issue.why}\n  - **suggestion:** ${issue.suggestion}\n`,
          );
        }
        stream.markdown("\n");
      } else if (v.verdict === "approve") {
        stream.markdown("_No issues. Approved as-is._\n\n");
      }
    } else if (ev.type === "stage-end") {
      const icon = ev.approved ? "\u2705" : "\u26a0\ufe0f";
      stream.markdown(
        `\n${icon} **Stage \`${ev.stage}\` ${ev.approved ? "approved" : "did not converge"}** after ${ev.iterations} iteration(s).\n\n`,
      );
    } else if (ev.type === "sandbox") {
      stream.markdown(
        `\n#### \ud83d\udda5\ufe0f Sandbox run\n\nexitCode=\`${ev.sandbox.exitCode}\` durationMs=\`${ev.sandbox.durationMs}\`\n\n` +
          `\`\`\`\n${ev.sandbox.stdout}\n\`\`\`\n\n`,
      );
      if (ev.sandbox.stderr) stream.markdown(`stderr:\n\`\`\`\n${ev.sandbox.stderr}\n\`\`\`\n\n`);
    }
  };
}

async function handleOpenSpecCommand(
  cmd: string,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  signal: AbortSignal,
): Promise<vscode.ChatResult> {
  const verb = cmd.replace(/^openspec-/, "");
  const done = (outcome: ReviewOutcome = "approved"): vscode.ChatResult => ({
    metadata: { outcome, command: cmd, hasFixProposal: false, iterations: 0 },
  });
  if (verb === "init") {
    stream.markdown("Run `openspec init` in a terminal at the workspace root.\n");
    return done();
  }
  if (verb === "new") {
    const id = request.prompt.trim();
    if (!id) {
      stream.markdown("Provide a change id, e.g. `@codecrosscheck /openspec-new add-foo`.\n");
      return failure("No change id supplied.", cmd);
    }
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      stream.markdown("No workspace folder open.\n");
      return failure("No workspace folder open.", cmd);
    }
    const dir = path.join(ws, "openspec", "changes", id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "proposal.md"), `# ${id}\n\n## Why\n\n## What Changes\n\n## Impact\n`);
    await fsp.writeFile(path.join(dir, "tasks.md"), `# Tasks: ${id}\n\n- [ ] 1.1 …\n`);
    stream.markdown(`Scaffolded \`openspec/changes/${id}/\`.\n`);
    return done();
  }
  if (verb === "review" || verb === "implement") {
    if (verb === "implement") {
      stream.markdown(
        "\u26a0\ufe0f `/openspec-implement` is deprecated — use `/openspec-review`. Running the equivalent now.\n\n",
      );
    }
    return handleOpenSpecReview(request, stream, signal);
  }
  if (verb === "archive") {
    stream.markdown(`Run \`openspec archive ${request.prompt.trim()}\` in a terminal.\n`);
    return done();
  }
  stream.markdown(`Unknown openspec command: \`${verb}\`.\n`);
  return failure(`Unknown openspec command: ${verb}.`, cmd);
}

/**
 * `/openspec-review <change-id>` — load the change frame, run the validator
 * pre-gate, drive the worker through PLAN + CODE stages, and write a
 * transcript that `/apply-review` can read. EXECUTE is skipped: the sandbox
 * cannot reproduce a real workspace, so its verdict is misleading for
 * spec-driven implementation work.
 *
 * `/openspec-implement` is registered as a deprecated alias and delegates
 * here after printing a one-line notice.
 */
async function handleOpenSpecReview(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  signal: AbortSignal,
): Promise<vscode.ChatResult> {
  const id = request.prompt.trim().split(/\s+/)[0] ?? "";
  if (!id) {
    stream.markdown(
      "Provide a change id, e.g. `@codecrosscheck /openspec-review add-foo`.\n",
    );
    return failure("No change id supplied.", "openspec-review");
  }

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const cfg = readConfig(vscode.workspace.getConfiguration("codecrosscheck"));

  // Load the change folder. Surface any error (missing folder, missing
  // proposal.md) in chat rather than letting it bubble past the participant.
  let change;
  try {
    change = loadChange(id, ws);
  } catch (err) {
    stream.markdown(
      `\u274c Could not load OpenSpec change \`${id}\`: \`${(err as Error).message}\`\n\n` +
        `Expected layout: \`openspec/changes/${id}/proposal.md\` (and optional \`tasks.md\`, \`specs/<capability>/spec.md\`).\n`,
    );
    return failure(`Could not load OpenSpec change ${id}.`, "openspec-review");
  }

  // Stream the proposal summary as the first message (spec requires this).
  const proposalSummary = change.proposal.length > 2000
    ? change.proposal.slice(0, 2000) + "\n\n\u2026 _(proposal truncated for chat; full text injected into the prompt frame)_"
    : change.proposal;
  stream.markdown(
    `## OpenSpec review: \`${id}\`\n\nLoaded from \`${path.relative(ws, change.changeDir) || change.changeDir}\`.\n\n` +
      `### Proposal\n\n${proposalSummary}\n\n---\n\n`,
  );

  // Model selection mirrors the main handler: prefer the chat-picker model for
  // the worker, configured reviewer for cross-vendor.
  const { worker: workerClient, reviewer: reviewerClient, sameModel } = resolveClients(cfg, request.model);

  if (sameModel) {
    stream.markdown(
      `> **Note:** worker and reviewer resolved to the same model (\`${workerClient.modelId}\`). ` +
        `Cross-vendor review is disabled.\n\n`,
    );
  }

  stream.markdown(
    `Running CodeCrossCheck (OpenSpec mode) \u2014 worker \`${workerClient.modelId}\`, reviewer \`${reviewerClient.modelId}\`, stages \`plan, code\`.\n\n`,
  );

  // Validator pre-gate: short-circuit the reviewer with a synthetic `revise`
  // verdict whenever `openspec validate <id> --strict` fails. Zero reviewer
  // tokens spent on structurally invalid specs.
  const preReviewFactory: (stage: Stage) => LoopOptions["preReview"] = () => async () => {
    const result = await validateStrict(id, ws);
    if (result.ok) return null;
    return {
      verdict: "revise",
      issues: [
        {
          severity: "high",
          where: `openspec validate ${id} --strict`,
          why: result.output.trim() || "validator pre-gate failed",
          suggestion: "Fix the OpenSpec change structure first.",
        },
      ],
    };
  };

  const transcript = await openTranscript(cfg);

  // Wrap the shared event handler with a translator that ALSO emits
  // `review-branch-iter` events for CODE-stage worker artifacts and reviewer
  // verdicts. That is the exact schema `/apply-review`'s
  // `findLatestTranscript` + `extractFixProposal` look for, so the user can
  // chain `/openspec-review` \u2192 `/apply-review` without any glue.
  const baseHandler = createPipelineEventHandler(stream, transcript.write);
  let codeIter = 0;
  const onEvent = (ev: PipelineEvent) => {
    baseHandler(ev);
    if (ev.type === "worker" && ev.stage === "code") {
      codeIter = ev.iteration;
      transcript.write({
        event: "review-branch-iter",
        iteration: ev.iteration,
        role: "worker",
        workerId: ev.modelId,
        artifact: ev.artifact,
      });
    } else if (ev.type === "verdict" && ev.stage === "code") {
      transcript.write({
        event: "review-branch-iter",
        iteration: ev.iteration,
        role: "reviewer",
        reviewerId: ev.modelId,
        verdict: ev.verdict,
        source: ev.source,
        changeId: id,
      });
    }
  };

  const frame = renderChangeFrame(change);
  const taskPrompt = request.prompt.replace(/^\s*\S+\s*/, "").trim();
  const attached = await readAttachments(request, stream);
  const fullPrompt = [
    taskPrompt || `Implement the OpenSpec change \`${id}\` exactly as specified.`,
    frame,
    attached,
  ]
    .filter(Boolean)
    .join("\n\n");

  const startedAt = Date.now();
  let outcome: ReviewOutcome = "exhausted";
  try {
    const result = await runPipeline(fullPrompt, {
      workerClient,
      reviewerClient,
      stages: ["plan", "code"],
      maxIters: cfg.maxIters,
      preReview: preReviewFactory,
      signal,
      onEvent,
    });
    outcome = result.cancelled ? "cancelled" : result.approved ? "approved" : "exhausted";
  } catch (err) {
    if (err instanceof ReviewCancelledError) throw err;
    stream.markdown(`\u274c Pipeline failed: \`${(err as Error).message}\`\n\n`);
    outcome = "failed";
  }

  transcript.write({
    event: "review-branch-done",
    approved: outcome === "approved",
    outcome,
    iterations: codeIter,
    elapsedMs: Date.now() - startedAt,
    changeId: id,
  });

  stream.markdown(
    `\n---\n\n## Next step\n\n` +
      (codeIter > 0
        ? `Run \`/apply-review\` to write the drafted edits to your workspace.\n\n`
        : `No CODE-stage artifact was produced. Fix the validator errors above or refine the prompt, then re-run.\n\n`),
  );
  if (codeIter > 0) {
    stream.button({ command: APPLY_COMMAND, title: "Apply the drafted edits", arguments: [] });
  }
  await flushTranscript(stream, transcript);
  linkTranscript(stream, transcript.path);
  return {
    metadata: { outcome, command: "openspec-review", hasFixProposal: codeIter > 0, iterations: codeIter },
  };
}

/** Node-backed `FsLike`, with the extra `remove` that pruning needs. */
function nodeFsLike(): FsLike & { remove(p: string): Promise<void> } {
  return {
    readDir: (dir) => fsp.readdir(dir),
    async stat(p) {
      const st = await fsp.stat(p);
      return { mtimeMs: st.mtimeMs };
    },
    readFile: (p) => fsp.readFile(p, "utf8"),
    async writeFile(p, content) {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, content, "utf8");
    },
    async exists(p) {
      try {
        await fsp.access(p);
        return true;
      } catch {
        return false;
      }
    },
    remove: (p) => fsp.rm(p, { force: true }),
  };
}

/**
 * Open a run transcript, ensuring the directory ignores itself in git and
 * pruning older runs. Transcripts hold full source diffs, so leaving them
 * committable and unbounded is both a disk and a disclosure problem.
 */
async function openTranscript(cfg: ResolvedConfig): Promise<Transcript> {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const root = path.join(ws, ".codecrosscheck");
  const dir = path.join(root, "runs");
  await fsp.mkdir(dir, { recursive: true });

  const ignorePath = path.join(root, ".gitignore");
  try {
    await fsp.access(ignorePath);
  } catch {
    await fsp.writeFile(ignorePath, "# CodeCrossCheck run transcripts contain full source diffs.\n*\n", "utf8");
  }

  await pruneTranscripts(dir, Math.max(0, cfg.keepTranscripts - 1), nodeFsLike()).catch(() => []);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}.jsonl`);

  return createTranscriptWriter(file, {
    writeFile: (p, c) => fsp.writeFile(p, c, "utf8"),
    appendFile: (p, c) => fsp.appendFile(p, c, "utf8"),
  });
}

function linkTranscript(stream: vscode.ChatResponseStream, transcriptPath: string): void {
  const uri = vscode.Uri.file(transcriptPath);
  stream.markdown(`Transcript: [${path.basename(transcriptPath)}](${uri.toString()})\n`);
}

/** A transcript failure must not fail a review that produced a verdict. */
async function flushTranscript(stream: vscode.ChatResponseStream, transcript: Transcript): Promise<void> {
  try {
    await transcript.flush();
  } catch (err) {
    stream.markdown(
      `\u26a0\ufe0f Transcript may be incomplete: \`${(err as Error).message}\`. ` +
        `\`/apply-review\` may not find this run.\n\n`,
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

const SKILL_NAME = "codecrosscheck-delegate";
const SKILL_FILE = "SKILL.md";

async function installDelegationSkill(context: vscode.ExtensionContext): Promise<void> {
  const src = path.join(context.extensionPath, "dist", "assets", "skills", SKILL_NAME, SKILL_FILE);
  const altSrc = path.join(context.extensionPath, "assets", "skills", SKILL_NAME, SKILL_FILE);
  const bundled = fs.existsSync(src) ? src : fs.existsSync(altSrc) ? altSrc : null;
  if (!bundled) {
    void vscode.window.showErrorMessage(
      `Bundled delegation skill not found in extension. Reinstall the extension.`,
    );
    return;
  }

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const choices: vscode.QuickPickItem[] = [
    {
      label: "Workspace",
      description: ws ? `${ws}\\.github\\skills\\${SKILL_NAME}` : "(no workspace open)",
      detail: "Team-shared, committed alongside the repo.",
    },
    {
      label: "User",
      description: `${path.join(os.homedir(), ".agents", "skills", SKILL_NAME)}`,
      detail: "Personal, roams via Settings Sync; available in every workspace.",
    },
  ];
  const pick = await vscode.window.showQuickPick(choices, {
    placeHolder: "Where should the delegation skill be installed?",
    ignoreFocusOut: true,
  });
  if (!pick) return;

  if (pick.label === "Workspace" && !ws) {
    void vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }

  const destBase = pick.label === "Workspace"
    ? path.join(ws!, ".github", "skills")
    : path.join(os.homedir(), ".agents", "skills");
  const destDir = path.join(destBase, SKILL_NAME);
  const dest = path.join(destDir, SKILL_FILE);

  if (fs.existsSync(dest)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${dest} already exists. Overwrite?`,
      { modal: true },
      "Overwrite",
    );
    if (overwrite !== "Overwrite") return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(bundled, dest);
  void vscode.window.showInformationMessage(
    `Installed delegation skill to ${dest}. Restart VS Code or reload the chat extension to discover it.`,
  );
}
