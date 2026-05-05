#!/usr/bin/env node
import { Command } from "commander";
import { getGlobalDispatcher } from "undici";
import * as fs from "node:fs";
import * as path from "node:path";
import { GithubModelsClient } from "./clients/githubModels.js";
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { loadChange, renderChangeFrame } from "./openspec/loader.js";
import { validateStrict } from "./openspec/validate.js";
import { getChangeDiff } from "./openspec/diff.js";
import type { Stage, Verdict } from "./schemas.js";
import type { LoopOptions } from "./loop.js";

const program = new Command();

program
  .name("codecrosscheck")
  .description("Two-model review loop: a worker LLM produces, a reviewer LLM judges.")
  .argument("<task>", "The task description")
  .option("--stages <list>", "Comma-separated stages: plan,code,execute", "plan,code,execute")
  .option("--max-iters <n>", "Maximum loop iterations per stage", "3")
  .option("--worker-model <id>", "Worker model id (GitHub Models)", "openai/gpt-5.4")
  .option("--reviewer-model <id>", "Reviewer model id (GitHub Models)", "openai/gpt-5.4")
  .option("--allow-network", "Allow network access in the EXECUTE sandbox", false)
  .option("--timeout-ms <n>", "Sandbox timeout in milliseconds", "30000")
  .option("--openspec <changeId>", "Run with OpenSpec change frame and validator pre-gate")
  .option("--diff", "Append the current branch diff (vs origin/main merge-base) to the task prompt", false)
  .option("--diff-base <ref>", "Override the base ref for --diff (default: merge-base with origin/main, falling back to HEAD)")
  .action(async (task: string, opts: Record<string, string | boolean>) => {
    const stages = String(opts.stages)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as Stage[];

    const workerClient = new GithubModelsClient({ modelId: String(opts.workerModel) });
    const reviewerClient = new GithubModelsClient({ modelId: String(opts.reviewerModel) });

    const transcriptPath = openTranscript();
    const writeEvent = (event: Record<string, unknown>) => {
      fs.appendFileSync(transcriptPath, JSON.stringify(event) + "\n", "utf8");
    };

    let resolvedTask = task;
    let preReviewFactory: ((stage: Stage) => LoopOptions["preReview"]) | undefined;

    if (opts.openspec) {
      const changeId = String(opts.openspec);
      const change = loadChange(changeId);
      const diff = await getChangeDiff().catch(() => "");
      const frame = renderChangeFrame(change, diff);
      resolvedTask = `${task}\n\n${frame}`;
      preReviewFactory = () => async (): Promise<Verdict | null> => {
        const result = await validateStrict(changeId);
        if (result.ok) return null;
        return {
          verdict: "revise",
          issues: [
            {
              severity: "high",
              where: `openspec validate ${changeId} --strict`,
              why: result.output.trim() || "validator pre-gate failed",
              suggestion: "Fix the structural issues in the OpenSpec change before requesting review.",
            },
          ],
        };
      };
      writeEvent({ event: "openspec-loaded", changeId });
    }

    if (opts.diff && !opts.openspec) {
      const baseRef = typeof opts.diffBase === "string" ? opts.diffBase : undefined;
      const diff = await getChangeDiff({ baseRef }).catch((err: Error) => {
        process.stderr.write(`codecrosscheck: --diff failed: ${err.message}\n`);
        return "";
      });
      if (diff.trim()) {
        resolvedTask = `${task}\n\n# Current branch diff\n\n\`\`\`diff\n${diff}\n\`\`\``;
        writeEvent({ event: "diff-attached", baseRef: baseRef ?? "auto", bytes: diff.length });
      } else {
        process.stderr.write("codecrosscheck: --diff produced no changes; running without diff context.\n");
      }
    }

    const onEvent = (event: PipelineEvent) => {
      writeEvent({ event: event.type, ...event });
      if (event.type === "verdict") {
        process.stdout.write(
          `[${event.stage} #${event.iteration}] ${event.verdict.verdict} (${event.modelId}, source=${event.source}) — ${event.verdict.issues.length} issue(s)\n`,
        );
      } else if (event.type === "stage-end") {
        process.stdout.write(
          `[${event.stage}] ${event.approved ? "APPROVED" : "NOT APPROVED"} after ${event.iterations} iteration(s)\n`,
        );
      }
    };

    const result = await runPipeline(resolvedTask, {
      workerClient,
      reviewerClient,
      stages,
      maxIters: Number(opts.maxIters),
      sandbox: {
        timeoutMs: Number(opts.timeoutMs),
        allowNetwork: Boolean(opts.allowNetwork),
      },
      preReview: preReviewFactory,
      onEvent,
    });

    writeEvent({ event: "completed", approved: result.approved });
    process.stdout.write(`\nTranscript: ${transcriptPath}\n`);
    await closeUndici();
    process.exit(result.approved ? 0 : 1);
  });

async function closeUndici(): Promise<void> {
  // Without this the keep-alive pool can crash libuv on shutdown on Windows.
  try {
    const d = getGlobalDispatcher();
    await (d as { close?: () => Promise<void> }).close?.();
  } catch {
    // best-effort
  }
}

function openTranscript(): string {
  const dir = path.join(process.cwd(), ".codecrosscheck", "runs");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `${stamp}.jsonl`);
}

program.parseAsync().catch(async (err: Error) => {
  process.stderr.write(`codecrosscheck: ${err.message}\n`);
  await closeUndici();
  process.exit(2);
});
