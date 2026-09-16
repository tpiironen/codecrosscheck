import { buildReviewer, buildWorker } from "./agents.js";
import type { ChatClient } from "./clients/ChatClient.js";
import { reviewLoop, type LoopOptions, type LoopResult } from "./loop.js";
import { runSandboxed, type SandboxOptions, type SandboxResult } from "./sandbox.js";
import type { Stage } from "./schemas.js";

export interface PipelineOptions {
  workerClient: ChatClient;
  reviewerClient: ChatClient;
  maxIters?: number;
  stages?: Stage[];
  sandbox?: SandboxOptions;
  /** Hook injected per-stage; used by OpenSpec mode. */
  preReview?: (stage: Stage) => LoopOptions["preReview"];
  /** Streamed event sink for transcript / chat UI. */
  onEvent?: (event: PipelineEvent) => void;
  /** Aborts the run between stages and cancels in-flight model calls. */
  signal?: AbortSignal;
}

export interface StageResult {
  stage: Stage;
  result: LoopResult;
  sandbox?: SandboxResult;
}

export interface PipelineResult {
  approved: boolean;
  stages: StageResult[];
  cancelled: boolean;
}

export type PipelineEvent =
  | { type: "stage-start"; stage: Stage; workerId: string; reviewerId: string }
  | { type: "iteration-start"; stage: Stage; iteration: number; maxIters: number }
  | { type: "worker-start"; stage: Stage; iteration: number; modelId: string }
  | { type: "worker"; stage: Stage; iteration: number; modelId: string; artifact: string }
  | { type: "reviewer-start"; stage: Stage; iteration: number; modelId: string }
  | {
      type: "verdict";
      stage: Stage;
      iteration: number;
      modelId: string;
      verdict: import("./schemas.js").Verdict;
      source: string;
    }
  | { type: "stage-end"; stage: Stage; approved: boolean; iterations: number }
  | { type: "sandbox"; stage: Stage; sandbox: SandboxResult }
  | { type: "completed"; approved: boolean; cancelled: boolean };

const DEFAULT_STAGES: Stage[] = ["plan", "code", "execute"];

export async function runPipeline(task: string, opts: PipelineOptions): Promise<PipelineResult> {
  const stages = opts.stages ?? DEFAULT_STAGES;
  const stageResults: StageResult[] = [];
  let approvedPlan: string | undefined;
  let codeArtifact: string | undefined;

  for (const stage of stages) {
    if (opts.signal?.aborted) {
      opts.onEvent?.({ type: "completed", approved: false, cancelled: true });
      return { approved: false, stages: stageResults, cancelled: true };
    }
    const worker = buildWorker(stage, opts.workerClient);
    const reviewer = buildReviewer(stage, opts.reviewerClient);
    const maxIters = opts.maxIters ?? 3;

    opts.onEvent?.({
      type: "stage-start",
      stage,
      workerId: worker.modelId,
      reviewerId: reviewer.modelId,
    });

    const stageInput = buildStageInput(stage, task, approvedPlan, codeArtifact);

    const result = await reviewLoop(stageInput, {
      worker: { modelId: worker.modelId, produce: (input, o) => worker.produce(input, o) },
      reviewer: {
        modelId: reviewer.modelId,
        judge: (artifact, o) => reviewer.judge(artifact, o),
      },
      maxIters,
      signal: opts.signal,
      preReview: opts.preReview?.(stage),
      onIterationStart: (iteration) =>
        opts.onEvent?.({ type: "iteration-start", stage, iteration, maxIters }),
      onWorkerStart: (iteration) =>
        opts.onEvent?.({ type: "worker-start", stage, iteration, modelId: worker.modelId }),
      onWorkerEnd: (iteration, artifact) =>
        opts.onEvent?.({
          type: "worker",
          stage,
          iteration,
          modelId: worker.modelId,
          artifact,
        }),
      onReviewerStart: (iteration) =>
        opts.onEvent?.({ type: "reviewer-start", stage, iteration, modelId: reviewer.modelId }),
      onReviewerEnd: (iteration, verdict, source) =>
        opts.onEvent?.({
          type: "verdict",
          stage,
          iteration,
          modelId: reviewer.modelId,
          verdict,
          source,
        }),
    });

    opts.onEvent?.({
      type: "stage-end",
      stage,
      approved: result.approved,
      iterations: result.iterations,
    });

    let sandbox: SandboxResult | undefined;
    if (stage === "execute" && result.approved) {
      sandbox = await runSandboxed(extractCode(result.artifact), opts.sandbox);
      opts.onEvent?.({ type: "sandbox", stage, sandbox });
    }

    stageResults.push({ stage, result, sandbox });

    if (result.cancelled) {
      opts.onEvent?.({ type: "completed", approved: false, cancelled: true });
      return { approved: false, stages: stageResults, cancelled: true };
    }

    if (!result.approved) {
      opts.onEvent?.({ type: "completed", approved: false, cancelled: false });
      return { approved: false, stages: stageResults, cancelled: false };
    }

    if (stage === "plan") approvedPlan = result.artifact;
    if (stage === "code") codeArtifact = result.artifact;
  }

  opts.onEvent?.({ type: "completed", approved: true, cancelled: false });
  return { approved: true, stages: stageResults, cancelled: false };
}

function buildStageInput(
  stage: Stage,
  task: string,
  approvedPlan: string | undefined,
  codeArtifact: string | undefined,
): string {
  switch (stage) {
    case "plan":
      return `# Task\n${task}`;
    case "code":
      return `# Task\n${task}\n\n# Approved plan (ground truth)\n${approvedPlan ?? "(no plan stage was run)"}`;
    case "execute":
      return [
        "# Task",
        task,
        "",
        "# Approved plan",
        approvedPlan ?? "(no plan stage was run)",
        "",
        "# Code to execute",
        codeArtifact ?? "(no code stage was run)",
      ].join("\n");
  }
}

function extractCode(artifact: string): string {
  const fence = artifact.match(/```(?:[a-zA-Z0-9]*)\n([\s\S]*?)```/);
  return fence?.[1] ?? artifact;
}
