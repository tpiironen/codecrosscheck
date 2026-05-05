import * as vscode from "vscode";
import { VscodeLmClient } from "./clients/vscodeLm.js";
import { buildReviewer, buildWorkerWithPrompt, loadPromptByName } from "./agents.js";
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { loadChange, renderChangeFrame } from "./openspec/loader.js";
import { validateStrict } from "./openspec/validate.js";
import { getChangeDiff } from "./openspec/diff.js";
import type { Stage, Verdict } from "./schemas.js";
import type { LoopOptions } from "./loop.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as fsp from "node:fs/promises";
import {
  applyEdits,
  buildFileInventory,
  composeApplyInput,
  deriveEdits,
  extractFixProposal,
  filterRejectedIssues,
  findLatestTranscript,
  harvestPathsFromText,
  issueFingerprint,
  parseBlockedFindings,
  parseDisagreements,
  parseReferencedFiles,
  runBuildGate,
  type ApplyOutcome,
  type BlockedFinding,
  type Disagreement,
  type FsLike,
} from "./applyReview.js";

const PARTICIPANT_ID = "codecrosscheck";
const SLASH_TO_STAGE: Record<string, Stage[]> = {
  plan: ["plan"],
  code: ["code"],
  execute: ["execute"],
  "review-branch": ["plan"],
};

export function activate(context: vscode.ExtensionContext): void {
  const handler: vscode.ChatRequestHandler = async (request, _ctx, stream, token) => {
    void token;
    const cmd = request.command ?? "";

    if (cmd.startsWith("openspec-")) {
      await handleOpenSpecCommand(cmd, request, stream);
      return;
    }

    const cfg = vscode.workspace.getConfiguration("codecrosscheck");
    const workerFamily = (cfg.get<string>("workerModelOverride") ?? "").trim() || (cfg.get<string>("workerModel") ?? "gpt-5.4");
    const reviewerFamily = (cfg.get<string>("reviewerModelOverride") ?? "").trim() || (cfg.get<string>("reviewerModel") ?? "claude-opus-4.6");
    const useChatPickerWorker = cfg.get<boolean>("useChatPickerWorker") ?? true;
    const maxIters = cfg.get<number>("maxIters") ?? 3;
    const timeoutMs = cfg.get<number>("execute.timeoutMs") ?? 30_000;
    const allowNetwork = cfg.get<boolean>("execute.allowNetwork") ?? false;

    const stages = SLASH_TO_STAGE[cmd] ?? (["plan", "code", "execute"] as Stage[]);

    // /review-branch: single CODE-reviewer pass on the diff. No worker, no loop —
    // the reviewer's verdict IS the review. Iterating would just have the worker
    // rewrite plans about reviewing instead of producing a review.
    if (cmd === "review-branch") {
      await handleReviewBranch(request, stream, cfg);
      return;
    }

    if (cmd === "apply-review") {
      await handleApplyReview(request, stream, cfg);
      return;
    }

    const resolvedPrompt = request.prompt;

    // Worker: prefer the model the user picked in the Copilot Chat picker
    // (request.model) so the participant respects their selection. Fall back
    // to the configured workerModel family. Reviewer stays config-driven so
    // it remains cross-vendor.
    const workerClient = useChatPickerWorker && request.model
      ? new VscodeLmClient({ family: request.model.family, model: request.model })
      : new VscodeLmClient({ family: stripVendor(workerFamily) });
    const reviewerClient = new VscodeLmClient({ family: stripVendor(reviewerFamily) });

    if (workerClient.modelId === reviewerClient.modelId) {
      stream.markdown(
        `> **Note:** worker and reviewer resolved to the same model (\`${workerClient.modelId}\`). ` +
          `Cross-vendor review is disabled. Pick a different model in the chat picker, ` +
          `or set \`codecrosscheck.useChatPickerWorker\` to \`false\`.\n\n`,
      );
    }

    stream.markdown(
      `Running CodeCrossCheck — worker \`${workerClient.modelId}\`, reviewer \`${reviewerClient.modelId}\`.\n\n`,
    );

    const transcriptPath = openTranscript();
    const writeEvent = (event: Record<string, unknown>) => {
      fs.appendFileSync(transcriptPath, JSON.stringify(event) + "\n", "utf8");
    };

    const onEvent = (ev: PipelineEvent) => {
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

    const startedAt = Date.now();
    const result = await runPipeline(resolvedPrompt, {
      workerClient,
      reviewerClient,
      stages,
      maxIters,
      sandbox: { timeoutMs, allowNetwork },
      onEvent,
    });
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

    writeEvent({ event: "completed", approved: result.approved });
    const uri = vscode.Uri.file(transcriptPath);

    // Final summary card. Always show the last verdict's outstanding issues and the
    // last artifact so the user has actionable output even when the cap is hit.
    const lastStage = result.stages[result.stages.length - 1];
    const lastIter = lastStage?.result.history[lastStage.result.history.length - 1];
    const lastVerdict = lastIter?.verdict;
    const lastArtifact = lastStage?.result.artifact ?? "";
    const totalIters = result.stages.reduce((n, s) => n + s.result.iterations, 0);

    stream.markdown(`\n---\n\n## Summary\n\n`);
    if (result.approved) {
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

    stream.markdown(
      `Transcript: [${path.basename(transcriptPath)}](${uri.toString()})\n`,
    );
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
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
  );
}

export function deactivate(): void {
  // no-op
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

  const cfg = vscode.workspace.getConfiguration("codecrosscheck");
  const reviewerFamily = stripVendor((cfg.get<string>("reviewerModelOverride") ?? "").trim() || (cfg.get<string>("reviewerModel") ?? "claude-opus-4.6"));
  const reviewerClient = new VscodeLmClient({ family: reviewerFamily });

  const reviewer = buildReviewer("code", reviewerClient);
  const verdict = await reviewer.judge(text);

  showVerdictWebview(verdict);
}

function showVerdictWebview(verdict: Verdict): void {
  const panel = vscode.window.createWebviewPanel(
    "codecrosscheckReview",
    `CodeCrossCheck — ${verdict.verdict}`,
    vscode.ViewColumn.Beside,
    {},
  );
  const rows = verdict.issues
    .map(
      (it) =>
        `<tr><td>${escape(it.severity)}</td><td>${escape(it.where)}</td><td>${escape(it.why)}</td><td>${escape(it.suggestion)}</td></tr>`,
    )
    .join("");
  panel.webview.html = `<!doctype html><html><body>
    <h2>Verdict: ${escape(verdict.verdict)}</h2>
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
 * /review-branch handler: produces an actual code review (not a meta-plan).
 * Single CODE-reviewer pass on the branch diff. The reviewer's verdict IS the
 * review report — no worker, no loop. Iterating would just have the worker
 * rewrite "how I will review" plans instead of producing the review.
 */
async function handleReviewBranch(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  cfg: vscode.WorkspaceConfiguration,
): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  stream.progress("Computing branch diff vs origin/main merge-base\u2026");
  const diff = await getChangeDiff({ cwd }).catch((err: Error) => {
    stream.markdown(`\u274c Could not compute branch diff: \`${err.message}\`\n\n`);
    return "";
  });
  if (!diff.trim()) {
    stream.markdown(`\u26a0\ufe0f No diff against \`origin/main\`. Nothing to review.\n\n`);
    return;
  }

  // Worker = picker model if set, else configured worker. Reviewer = configured reviewer.
  const workerFamilyCfg = (cfg.get<string>("workerModelOverride") ?? "").trim() || (cfg.get<string>("workerModel") ?? "gpt-5.4");
  const reviewerFamilyCfg = (cfg.get<string>("reviewerModelOverride") ?? "").trim() || (cfg.get<string>("reviewerModel") ?? "openai/gpt-5.4");
  const useChatPickerWorker = cfg.get<boolean>("useChatPickerWorker") ?? true;
  let maxIters = cfg.get<number>("maxIters") ?? 3;

  const workerClient = useChatPickerWorker && request.model
    ? new VscodeLmClient({ family: request.model.family, model: request.model })
    : new VscodeLmClient({ family: stripVendor(workerFamilyCfg) });
  const reviewerClient = new VscodeLmClient({ family: stripVendor(reviewerFamilyCfg) });

  const fixerPrompt = loadPromptByName("review_branch_fixer");
  const fixer = buildWorkerWithPrompt(fixerPrompt, workerClient);
  const reviewer = buildReviewer("code", reviewerClient);

  const userTask = request.prompt.trim();
  // Recognise user adjudication directive that overrides any worker rebuttals.
  const forceFixAll = /\bforce-fix-all\b/i.test(userTask);
  // Recognise per-invocation override of `codecrosscheck.maxIters`.
  // Accepts `max-iters=N`, `maxiters=N`, or `iters=N` (whole-token, 1..20).
  const itersMatch = userTask.match(/\b(?:max-?iters|iters)\s*=\s*(\d{1,2})\b/i);
  if (itersMatch) {
    const parsed = Number.parseInt(itersMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
      maxIters = parsed;
    }
  }
  const taskHeader = userTask
    ? `# Reviewer instructions\n${userTask}`
    : `# Reviewer instructions\nReview this branch diff for OWASP issues, dead code, missing tests, and OpenSpec drift. Cite file:line for each issue.`;
  const diffBlock = `# Branch diff (vs origin/main merge-base)\n\n\`\`\`diff\n${diff}\n\`\`\``;

  const transcriptPath = openTranscript();
  const writeEvent = (e: object) => fs.appendFileSync(transcriptPath, JSON.stringify(e) + "\n", "utf8");

  stream.markdown(
    `\u23f3 Branch review: worker \`${fixer.modelId}\` \u2194 reviewer \`${reviewer.modelId}\` \u00b7 diff \`${diff.length}\` chars \u00b7 cap \`${maxIters}\` iterations\n\n`,
  );

  const startedAt = Date.now();
  let verdict: Verdict | undefined;
  let lastFixProposal = "";
  let iter = 0;

  // Findings the worker has already rebutted with `**Fix:** Disagree: …` —
  // fingerprinted by `${severity}|${where}|${why}` so a near-identical
  // restatement of the same finding in a later round can be detected and
  // dropped. Without this, the reviewer keeps re-flagging the disagreed
  // finding, the worker keeps rebutting, and the loop burns iterations on
  // a question only the user can adjudicate. `force-fix-all` bypasses
  // this memory by user opt-in.
  const rejectedFingerprints = new Set<string>();
  // Disagreements accumulated across all rounds (each entry seen once,
  // keyed by fingerprint via the Set above) so the final summary shows
  // every rebuttal, not just the ones from the last proposal.
  const cumulativeDisagreements: Array<Disagreement & { fingerprint: string }> = [];

  // FsLike for buildFileInventory (only needs exists + readFile here).
  const inventoryFs: FsLike = {
    async readDir(dir) { return fsp.readdir(dir); },
    async stat(p) { const st = await fsp.stat(p); return { mtimeMs: st.mtimeMs }; },
    async readFile(p) { return fsp.readFile(p, "utf8"); },
    async writeFile() { /* unused */ },
    async exists(p) { try { await fsp.access(p); return true; } catch { return false; } },
  };
  const fileContextCap = 60_000; // total chars budget for repo file context

  // ---- Iteration 1: reviewer reads the raw diff. ----
  iter = 1;
  stream.markdown(`---\n\n### Iteration ${iter} / ${maxIters} \u2014 initial review\n\n`);
  stream.progress(`Reviewer \`${reviewer.modelId}\` reading diff\u2026`);
  try {
    verdict = await reviewer.judge(`${taskHeader}\n\n${diffBlock}`);
  } catch (err) {
    stream.markdown(`\u274c Reviewer call failed: \`${(err as Error).message}\`\n\n`);
    return;
  }
  renderVerdict(stream, verdict);
  writeEvent({ event: "review-branch-iter", iteration: iter, role: "reviewer", reviewerId: reviewer.modelId, verdict });

  // ---- Iterations 2..N: worker proposes fixes, reviewer re-judges. ----
  while (iter < maxIters && verdict.verdict !== "approve") {
    iter++;
    stream.markdown(`---\n\n### Iteration ${iter} / ${maxIters} \u2014 worker proposes fixes\n\n`);
    stream.progress(`Worker \`${fixer.modelId}\` drafting fixes for ${verdict.issues.length} issue(s)\u2026`);

    // Harvest workspace-relative paths the worker is likely to need:
    //   1. file:line cited in each finding's `where`
    //   2. paths in the worker's prior fix proposal (incl. "Data I need" sections)
    // Read those files (cap total) and inject as a "Repository file context"
    // block so the fixer can produce concrete patches instead of sketches.
    const harvested = new Set<string>();
    for (const it of verdict.issues) {
      for (const p of harvestPathsFromText(it.where)) harvested.add(p);
      for (const p of harvestPathsFromText(it.suggestion)) harvested.add(p);
    }
    if (lastFixProposal) {
      for (const p of harvestPathsFromText(lastFixProposal)) harvested.add(p);
      for (const p of parseReferencedFiles(lastFixProposal)) harvested.add(p);
    }
    let fileContextBlock = "";
    if (harvested.size > 0) {
      stream.progress(`Reading ${harvested.size} referenced file(s) for fixer context\u2026`);
      const { inventory, missing } = await buildFileInventory(cwd, Array.from(harvested), inventoryFs);
      const truncated = inventory.length > fileContextCap
        ? inventory.slice(0, fileContextCap) + `\n\n_(repo file context truncated at ${fileContextCap} chars)_`
        : inventory;
      if (truncated.length > 0) {
        fileContextBlock = [
          "# Repository file context",
          "",
          "_Files cited by the reviewer findings or by your prior proposal. Use these as the canonical current source when producing concrete patches; do NOT request them as data._",
          "",
          truncated,
        ].join("\n");
      }
      if (missing.length > 0) {
        fileContextBlock += `\n\n_Unreadable: ${missing.map((m) => `\`${m}\``).join(", ")}_\n`;
      }
    }

    const fixerInput = buildFixerInput({
      taskHeader,
      diffBlock,
      currentVerdict: verdict,
      priorFixProposal: lastFixProposal,
      round: iter - 1,
      fileContextBlock,
      forceFixAll,
    });
    try {
      lastFixProposal = await fixer.produce(fixerInput);
    } catch (err) {
      stream.markdown(`\u274c Worker call failed: \`${(err as Error).message}\`\n\n`);
      break;
    }
    writeEvent({ event: "review-branch-iter", iteration: iter, role: "worker", workerId: fixer.modelId, artifact: lastFixProposal });
    renderWorkerArtifact(stream, lastFixProposal);

    // Capture this round's worker rebuttals against the verdict that was
    // fed in. Each `**Fix:** Disagree: …` section's id is 1-based and
    // matches the order of `verdict.issues`. Mark every rebutted issue's
    // fingerprint as "rejected" so the next reviewer pass cannot send it
    // back through the loop. `force-fix-all` opts out: the user wants
    // every finding fixed regardless of prior pushback.
    if (!forceFixAll) {
      const roundDisagreements = parseDisagreements(lastFixProposal);
      for (const d of roundDisagreements) {
        const issue = verdict.issues[d.id - 1];
        if (!issue) continue;
        const fp = issueFingerprint(issue);
        if (!rejectedFingerprints.has(fp)) {
          rejectedFingerprints.add(fp);
          cumulativeDisagreements.push({ ...d, fingerprint: fp });
        }
      }
    }

    stream.markdown(`#### Reviewer re-judging\n\n`);
    stream.progress(`Reviewer \`${reviewer.modelId}\` checking fixes\u2026`);
    const reviewArtifact = [
      "# Re-review: judge a proposed fix",
      "",
      "You previously reviewed this branch and produced findings. The author has responded with a fix proposal.",
      "Your job is to judge **whether the proposal, IF APPLIED, would resolve every prior finding without introducing new issues**.",
      "",
      "# Critical instructions",
      "",
      "- The diff below is the **BEFORE** state \u2014 what is currently committed. The fix proposal describes what would change.",
      "- Do **NOT** re-flag a finding just because the diff still shows the original problem. The diff is unchanged by design \u2014 the proposal is what would change. You are evaluating the proposal, not the diff.",
      "- For each prior finding, decide: does the proposal address it adequately? If yes, do **not** list it again. If no (proposal missing, vague, or technically wrong), list it again and say specifically what is missing or wrong.",
      "- You MAY raise new findings only if the **proposal itself** introduces them (e.g., proposed code contains a clear bug, breaks an API, or misnames something visible in the diff).",
      "- `approve` when every prior finding is adequately addressed by the proposal.",
      "",
      taskHeader,
      "",
      "# Branch diff (BEFORE state)",
      "",
      diffBlock.replace(/^# .+\n\n/, ""),
      "",
      "# Prior findings",
      "",
      formatVerdictForRereview(verdict),
      "",
      "# Worker's fix proposal (proposed AFTER state)",
      "",
      lastFixProposal,
    ].join("\n");
    try {
      verdict = await reviewer.judge(reviewArtifact);
    } catch (err) {
      stream.markdown(`\u274c Reviewer call failed: \`${(err as Error).message}\`\n\n`);
      break;
    }

    // Drop any newly-listed findings that match a fingerprint the worker
    // already rebutted in an earlier round. The reviewer is stateless and
    // tends to restate the same concern; without this filter the loop
    // ping-pongs forever. If filtering empties the issue list, the helper
    // auto-flips the verdict to `approve` so the loop exits cleanly.
    {
      const filtered = filterRejectedIssues(verdict, rejectedFingerprints);
      if (filtered.dropped > 0) {
        verdict = filtered.verdict;
        stream.markdown(
          `_Skipped ${filtered.dropped} finding(s) the worker already rebutted in a prior round. ` +
            `Use \`force-fix-all\` on a future run to override._\n\n`,
        );
      }
    }

    renderVerdict(stream, verdict);
    writeEvent({ event: "review-branch-iter", iteration: iter, role: "reviewer", reviewerId: reviewer.modelId, verdict });
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const counts = countSeverities(verdict);
  const approved = verdict?.verdict === "approve";

  stream.markdown(`---\n\n## Summary\n\n`);
  if (approved) {
    stream.markdown(
      `\u2705 **Approved** after ${iter} iteration(s) in ${elapsedSec}s. Reviewer is satisfied with the worker's fix proposal.\n\n`,
    );
  } else {
    stream.markdown(
      `\u26a0\ufe0f **Did not converge** after ${iter} iteration(s) in ${elapsedSec}s. ` +
        `Reviewer still flags ${verdict?.issues.length ?? 0} issue(s) ` +
        `(\ud83d\udd34 ${counts.high} high, \ud83d\udfe1 ${counts.medium} medium, \ud83d\udd35 ${counts.low} low). ` +
        `Note: the residual findings target the **proposal**, not the original branch \u2014 the proposal itself may still contain applicable patches.\n\n`,
    );
  }

  if (lastFixProposal) {
    stream.markdown(
      `**Next:** run \`/apply-review\` to apply the patches in the fix proposal below. ` +
        (approved
          ? `The reviewer is satisfied; once applied, run \`git diff\` and commit.\n\n`
          : `Then re-run \`/review-branch\` to address any residual findings, raise \`codecrosscheck.maxIters\` for more rounds, or scope the prompt down.\n\n`),
    );
    stream.markdown(`### Final fix proposal\n\n<details${approved ? " open" : ""}><summary>${lastFixProposal.length} chars</summary>\n\n`);
    stream.markdown(`\`\`\`markdown\n${lastFixProposal}\n\`\`\`\n\n</details>\n\n`);
  } else if (!approved) {
    stream.markdown(
      `**Next steps:** raise \`codecrosscheck.maxIters\`, scope the prompt, or address the findings manually.\n\n`,
    );
  }

  // Surface worker rebuttals so the user can adjudicate. We use the
  // cumulative list collected across all rounds (not just the last
  // proposal) because the loop drops rebutted findings from later
  // verdicts, so by the time we exit they may no longer appear in the
  // final fix proposal at all.
  const disagreements: Disagreement[] = cumulativeDisagreements;
  if (disagreements.length > 0) {
    stream.markdown(`### \ud83e\udd14 ${disagreements.length} worker disagreement(s) pending your decision\n\n`);
    stream.markdown(
      "The worker rebutted the following reviewer finding(s) instead of fixing them. " +
        "**Review each rebuttal below and decide.**\n\n",
    );
    for (const d of disagreements) {
      stream.markdown(`#### ${d.id}. ${d.heading}\n\n`);
      stream.markdown(`> ${d.rebuttal.replace(/\n/g, "\n> ")}\n\n`);
    }
    stream.markdown(
      "**To proceed:**\n\n" +
        "- **Accept the rebuttals** (you agree the worker is right): run `/apply-review` \u2014 the rebutted findings simply have no edits, so nothing is applied for them.\n" +
        "- **Override the rebuttals** (force the worker to fix anyway): re-run `/review-branch` with `force-fix-all` in the prompt, e.g. `@codecrosscheck /review-branch force-fix-all`. The fixer will be told to produce concrete fixes for every finding and may not rebut.\n\n",
    );
  }

  // Surface dodge patterns (sketches, "Data I need", "I cannot produce") that
  // look like fixes but produce nothing applicable. parseBlockedFindings
  // already excludes any issue captured by parseDisagreements.
  const blocked: BlockedFinding[] = lastFixProposal ? parseBlockedFindings(lastFixProposal) : [];
  if (blocked.length > 0) {
    stream.markdown(`### \ud83d\udeab ${blocked.length} finding(s) the worker did not produce a real patch for\n\n`);
    stream.markdown(
      "For these issues the worker emitted prose, sketches, or requests for more source files instead of a concrete patch. " +
        "`/apply-review` will produce zero edits for them.\n\n",
    );
    for (const b of blocked) {
      stream.markdown(`- **${b.id}. ${b.heading}** \u2014 ${b.reason}\n`);
    }
    stream.markdown(
      "\n**Likely cause:** the cited file lives outside the current workspace root, so the file-context injector could not read it. " +
        "Open the parent multi-project folder as the workspace and re-run `/review-branch`, or re-run with `force-fix-all` to require concrete fixes.\n\n",
    );
  }

  writeEvent({ event: "review-branch-done", approved, iterations: iter, elapsedMs: Date.now() - startedAt });
  const uri = vscode.Uri.file(transcriptPath);
  stream.markdown(`Transcript: [${path.basename(transcriptPath)}](${uri.toString()})\n`);
}

/**
 * /apply-review handler: read the latest review transcript, derive concrete
 * file edits from the worker's last fix proposal, and apply them. The handler
 * is the apply step of a /review-branch -> /apply-review -> git diff loop.
 */
async function handleApplyReview(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  cfg: vscode.WorkspaceConfiguration,
): Promise<void> {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) {
    stream.markdown("\u274c No workspace folder open.\n");
    return;
  }
  const transcriptsDir = path.join(ws, ".codecrosscheck", "runs");
  const nodeFs: FsLike = {
    async readDir(dir) {
      return fsp.readdir(dir);
    },
    async stat(p) {
      const st = await fsp.stat(p);
      return { mtimeMs: st.mtimeMs };
    },
    async readFile(p) {
      return fsp.readFile(p, "utf8");
    },
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
  };

  stream.progress("Locating latest review transcript\u2026");
  const transcriptPath = await findLatestTranscript(transcriptsDir, nodeFs);
  if (!transcriptPath) {
    stream.markdown(
      "\u274c No review transcript found. Run `@codecrosscheck /review-branch` first to produce a fix proposal, then run `/apply-review`.\n",
    );
    return;
  }
  const fixProposal = await extractFixProposal(transcriptPath, nodeFs);
  if (!fixProposal) {
    stream.markdown(
      `\u274c Transcript [${path.basename(transcriptPath)}](${vscode.Uri.file(transcriptPath).toString()}) ` +
        "has no worker fix proposal to apply. Re-run `/review-branch`.\n",
    );
    return;
  }

  const referenced = parseReferencedFiles(fixProposal.proposal);
  stream.markdown(
    `\ud83d\udcc4 Applying fix proposal from [${path.basename(transcriptPath)}](${vscode.Uri.file(transcriptPath).toString()}) ` +
      `(iter ${fixProposal.iteration}, ${referenced.length} file(s) referenced).\n\n`,
  );

  const dryRun = cfg.get<boolean>("applyReview.dryRun") ?? false;
  const testCommand = (cfg.get<string>("applyReview.testCommand") ?? "").trim();
  const buildCommand = (cfg.get<string>("applyReview.buildCommand") ?? "").trim();
  const buildTimeoutMs = cfg.get<number>("applyReview.buildTimeoutMs") ?? 300_000;

  const { inventory, missing } = await buildFileInventory(ws, referenced, nodeFs);
  if (missing.length > 0) {
    stream.markdown(
      `\u26a0\ufe0f Skipped ${missing.length} unreadable path(s): ${missing.map((m) => `\`${m}\``).join(", ")}.\n\n`,
    );
  }

  // Worker for edit derivation: same selection logic as /review-branch worker.
  const workerFamilyCfg = (cfg.get<string>("workerModelOverride") ?? "").trim() || (cfg.get<string>("workerModel") ?? "gpt-5.4");
  const useChatPickerWorker = cfg.get<boolean>("useChatPickerWorker") ?? true;
  const workerClient = useChatPickerWorker && request.model
    ? new VscodeLmClient({ family: request.model.family, model: request.model })
    : new VscodeLmClient({ family: stripVendor(workerFamilyCfg) });

  const userExtra = request.prompt.trim();
  const composed = composeApplyInput(
    userExtra ? `${fixProposal.proposal}\n\n# Additional instructions from user\n\n${userExtra}` : fixProposal.proposal,
    inventory,
  );

  let systemPrompt: string;
  try {
    systemPrompt = loadPromptByName("apply_review_worker");
  } catch (err) {
    stream.markdown(`\u274c Could not load apply prompt: \`${(err as Error).message}\`\n`);
    return;
  }

  stream.progress(`Worker \`${workerClient.modelId}\` deriving edits\u2026`);
  let edits;
  try {
    edits = await deriveEdits(workerClient, systemPrompt, composed);
  } catch (err) {
    stream.markdown(`\u274c Worker failed to produce structured edits: \`${(err as Error).message}\`\n`);
    return;
  }

  // Persist a debug artifact next to the source transcript so failures are
  // diagnosable after the fact (the Chat session itself doesn't show the
  // worker's raw oldString/newString).
  const applyLogPath = transcriptPath.replace(/\.jsonl$/i, "-apply.json");

  if (edits.length === 0) {
    stream.markdown("\u26a0\ufe0f Worker returned zero edits. Nothing to apply.\n");
    await nodeFs.writeFile(
      applyLogPath,
      JSON.stringify(
        { transcriptPath, iteration: fixProposal.iteration, referenced, missing, edits, outcomes: [] },
        null,
        2,
      ),
    );
    stream.markdown(`\ud83d\udcc4 Debug log: [${path.basename(applyLogPath)}](${vscode.Uri.file(applyLogPath).toString()})\n`);
    return;
  }
  stream.markdown(`Worker proposed **${edits.length}** edit(s)${dryRun ? " (dry-run mode)" : ""}.\n\n`);

  const outcomes: ApplyOutcome[] = await applyEdits(ws, edits, nodeFs, { dryRun });
  renderApplyOutcomes(stream, outcomes, dryRun);

  await nodeFs.writeFile(
    applyLogPath,
    JSON.stringify(
      { transcriptPath, iteration: fixProposal.iteration, referenced, missing, edits, outcomes },
      null,
      2,
    ),
  );

  const appliedCount = outcomes.filter((o) => o.status === "applied").length;
  const dryCount = outcomes.filter((o) => o.status === "dry-run").length;
  const skippedCount = outcomes.filter((o) => o.status === "skipped").length;

  stream.markdown(`---\n\n## Summary\n\n`);
  if (dryRun) {
    stream.markdown(
      `\ud83d\udd0d **Dry run** \u2014 would apply ${dryCount} edit(s), skip ${skippedCount}. ` +
        "Set `codecrosscheck.applyReview.dryRun` to `false` to write changes.\n\n",
    );
  } else {
    stream.markdown(
      `\u2705 Applied **${appliedCount}** edit(s); skipped **${skippedCount}**.\n\n` +
        "**Next steps:** run `git diff` to inspect, then commit. Re-run `/review-branch` to verify findings are closed.\n\n",
    );
  }
  stream.markdown(`\ud83d\udcc4 Debug log: [${path.basename(applyLogPath)}](${vscode.Uri.file(applyLogPath).toString()})\n\n`);

  if (!dryRun && appliedCount > 0 && testCommand) {
    const terminalName = "CodeCrossCheck: apply-review tests";
    let term = vscode.window.terminals.find((t) => t.name === terminalName);
    if (!term) term = vscode.window.createTerminal({ name: terminalName, cwd: ws });
    term.show(false);
    term.sendText(testCommand, true);
    stream.markdown(`\u25b6\ufe0f Started \`${testCommand}\` in terminal **${terminalName}**.\n`);
  }

  // Build gate: run synchronously, capture exit code + tail of output, and
  // surface a clear pass/fail block in chat. On failure, point the user at
  // /review-branch with the build output so the next round can see what
  // broke. The gate runs only when edits actually landed (dry-run or
  // zero-edit invocations skip it).
  if (!dryRun && appliedCount > 0 && buildCommand) {
    stream.markdown(`---\n\n## Build gate\n\n`);
    stream.progress(`Running \`${buildCommand}\`\u2026`);
    const result = await runBuildGate({ cwd: ws, command: buildCommand, timeoutMs: buildTimeoutMs });
    const elapsedSec = (result.durationMs / 1000).toFixed(1);
    if (result.exitCode === 0) {
      stream.markdown(
        `\u2705 \`${buildCommand}\` exited 0 in ${elapsedSec}s. Edits compile.\n\n`,
      );
    } else {
      const reason = result.timedOut
        ? `timed out after ${elapsedSec}s`
        : `exited with code ${result.exitCode ?? "unknown"} in ${elapsedSec}s`;
      stream.markdown(
        `\u274c \`${buildCommand}\` ${reason}. The applied edits do not build.\n\n` +
          "**Likely cause:** the worker referenced symbols (types, methods, overloads) " +
          "that aren't in the current source \u2014 e.g. a helper class that was supposed " +
          "to come from an earlier round but wasn't applied. Re-run `/review-branch` " +
          "with the build output below pasted as additional reviewer instructions, " +
          "or revert with `git restore .` if the diff is unsalvageable.\n\n",
      );
      stream.markdown(
        `<details open><summary>Build output (${result.output.length} chars${result.truncated ? ", truncated" : ""})</summary>\n\n` +
          "```\n" + result.output + "\n```\n\n</details>\n\n",
      );
    }
  }
}

function renderApplyOutcomes(stream: vscode.ChatResponseStream, outcomes: ApplyOutcome[], dryRun: boolean): void {
  for (const o of outcomes) {
    const icon =
      o.status === "applied" ? "\u2705" : o.status === "dry-run" ? "\ud83d\udd0d" : "\u26a0\ufe0f";
    const tail = o.reason ? ` \u2014 ${o.reason}` : "";
    const verb = o.status === "dry-run" ? "would apply" : o.status;
    stream.markdown(`- ${icon} \`${o.path}\` \u2014 ${verb}${tail}\n  - **why:** ${o.why}\n`);
  }
  void dryRun;
  stream.markdown("\n");
}

function buildFixerInput(args: {
  taskHeader: string;
  diffBlock: string;
  currentVerdict: Verdict;
  priorFixProposal: string;
  round: number;
  fileContextBlock?: string;
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
  const ctxBlock = args.fileContextBlock ? `\n\n${args.fileContextBlock}` : "";
  const overrideBlock = args.forceFixAll
    ? "\n\n# User override\n\nThe user has explicitly overridden any rebuttals. You MUST produce a concrete fix for every reviewer finding above. Do NOT use `**Fix:** Disagree:` in this proposal."
    : "";
  return [
    args.taskHeader,
    "",
    args.diffBlock,
    ctxBlock,
    "",
    "# Reviewer findings to address",
    issues,
    priorBlock,
    overrideBlock,
    "",
    `Produce fix proposal round ${args.round + 1}. Address every finding above.`,
  ].join("\n");
}

function formatVerdictForRereview(v: Verdict): string {
  return v.issues
    .map(
      (it, idx) =>
        `${idx + 1}. [${it.severity}] ${it.where}\n   why: ${it.why}\n   suggestion: ${it.suggestion}`,
    )
    .join("\n");
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

function renderWorkerArtifact(stream: vscode.ChatResponseStream, artifact: string): void {
  const max = 4000;
  const truncated = artifact.length > max;
  const shown = truncated ? artifact.slice(0, max) + "\n\n... (truncated, see transcript) ..." : artifact;
  stream.markdown(`<details><summary>Fix proposal (${artifact.length} chars)</summary>\n\n${shown}\n\n</details>\n\n`);
}


async function handleOpenSpecCommand(
  cmd: string,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
): Promise<void> {
  const verb = cmd.replace(/^openspec-/, "");
  if (verb === "init") {
    stream.markdown("Run `openspec init` in a terminal at the workspace root.\n");
    return;
  }
  if (verb === "new") {
    const id = request.prompt.trim();
    if (!id) {
      stream.markdown("Provide a change id, e.g. `@codecrosscheck /openspec-new add-foo`.\n");
      return;
    }
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      stream.markdown("No workspace folder open.\n");
      return;
    }
    const dir = path.join(ws, "openspec", "changes", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "proposal.md"), `# ${id}\n\n## Why\n\n## What Changes\n\n## Impact\n`);
    fs.writeFileSync(path.join(dir, "tasks.md"), `# Tasks: ${id}\n\n- [ ] 1.1 …\n`);
    stream.markdown(`Scaffolded \`openspec/changes/${id}/\`.\n`);
    return;
  }
  if (verb === "implement") {
    const id = request.prompt.trim();
    if (!id) {
      stream.markdown("Provide a change id.\n");
      return;
    }
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const change = loadChange(id, ws);
    const cfg = vscode.workspace.getConfiguration("codecrosscheck");
    const useChatPickerWorker = cfg.get<boolean>("useChatPickerWorker") ?? true;
    const workerClient = useChatPickerWorker && request.model
      ? new VscodeLmClient({ family: request.model.family, model: request.model })
      : new VscodeLmClient({
          family: stripVendor(cfg.get<string>("workerModel") ?? "gpt-5.4"),
        });
    const reviewerClient = new VscodeLmClient({
      family: stripVendor(cfg.get<string>("reviewerModel") ?? "claude-opus-4.6"),
    });
    const frame = renderChangeFrame(change);
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
    stream.markdown(`Implementing change \`${id}\` with OpenSpec frame attached.\n\n`);
    await runPipeline(`${request.prompt}\n\n${frame}`, {
      workerClient,
      reviewerClient,
      maxIters: cfg.get<number>("maxIters") ?? 3,
      preReview: preReviewFactory,
      onEvent: (ev) => {
        if (ev.type === "stage-end") {
          stream.markdown(`_${ev.stage}: ${ev.approved ? "approved" : "not approved"}._\n\n`);
        }
      },
    });
    return;
  }
  if (verb === "archive") {
    stream.markdown(`Run \`openspec archive ${request.prompt.trim()}\` in a terminal.\n`);
    return;
  }
  stream.markdown(`Unknown openspec command: \`${verb}\`.\n`);
}

function stripVendor(model: string): string {
  // vscode.lm wants `family` only; convert "openai/gpt-5.4" -> "gpt-5.4".
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function openTranscript(): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const dir = path.join(ws, ".codecrosscheck", "runs");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `${stamp}.jsonl`);
}

function escape(s: string): string {
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
