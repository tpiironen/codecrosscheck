import type { Worker, Reviewer } from "./agents.js";
import type { Verdict } from "./schemas.js";

export interface LoopEvent {
  iteration: number;
  artifact: string;
  verdict: Verdict;
  /** "model" for real reviewer calls; other values reserved for synthesized verdicts (e.g. "validator"). */
  source?: string;
}

export interface LoopOptions {
  worker: Worker;
  reviewer: Reviewer;
  maxIters?: number;
  /**
   * Optional pre-reviewer hook. If it returns a verdict, that verdict is used INSTEAD of calling
   * the reviewer (zero reviewer tokens consumed). Used by the OpenSpec validator pre-gate.
   */
  preReview?: (artifact: string, iteration: number) => Promise<Verdict | null> | Verdict | null;
  /**
   * Live progress callbacks. Fire BEFORE the underlying call so the UI can show "thinking…"
   * indicators. `onWorkerStart` fires before `worker.produce`; `onWorkerEnd` after, with the
   * artifact. `onReviewerStart`/`onReviewerEnd` mirror the reviewer call (and are skipped when
   * the pre-review hook short-circuits).
   */
  onIterationStart?: (iteration: number) => void;
  onWorkerStart?: (iteration: number) => void;
  onWorkerEnd?: (iteration: number, artifact: string) => void;
  onReviewerStart?: (iteration: number) => void;
  onReviewerEnd?: (iteration: number, verdict: Verdict, source: string) => void;
  /** Aborts the run between iterations and cancels the in-flight model call. */
  signal?: AbortSignal;
}

export interface LoopResult {
  artifact: string;
  history: LoopEvent[];
  approved: boolean;
  iterations: number;
  /** True when the run stopped because the signal aborted, not because it finished. */
  cancelled: boolean;
}

export async function reviewLoop(
  initialInput: string,
  opts: LoopOptions,
): Promise<LoopResult> {
  const maxIters = opts.maxIters ?? 3;
  const history: LoopEvent[] = [];
  const signal = opts.signal;
  let input = initialInput;
  let lastArtifact = "";
  let completed = 0;

  for (let i = 1; i <= maxIters; i++) {
    if (signal?.aborted) {
      return { artifact: lastArtifact, history, approved: false, iterations: completed, cancelled: true };
    }
    opts.onIterationStart?.(i);
    opts.onWorkerStart?.(i);
    const artifact = await opts.worker.produce(input, { signal });
    lastArtifact = artifact;
    opts.onWorkerEnd?.(i, artifact);

    if (signal?.aborted) {
      return { artifact: lastArtifact, history, approved: false, iterations: completed, cancelled: true };
    }

    let verdict: Verdict | null = null;
    let source = "model";
    if (opts.preReview) {
      const synthesized = await opts.preReview(artifact, i);
      if (synthesized) {
        verdict = synthesized;
        source = "validator";
      }
    }
    if (!verdict) {
      opts.onReviewerStart?.(i);
      verdict = await opts.reviewer.judge(artifact, { signal });
    }
    opts.onReviewerEnd?.(i, verdict, source);

    history.push({ iteration: i, artifact, verdict, source });
    completed = i;

    if (verdict.verdict === "approve") {
      return { artifact, history, approved: true, iterations: i, cancelled: false };
    }

    input = buildRevisionInput(initialInput, artifact, verdict);
  }

  return { artifact: lastArtifact, history, approved: false, iterations: maxIters, cancelled: false };
}

function buildRevisionInput(originalTask: string, priorArtifact: string, verdict: Verdict): string {
  const issues = verdict.issues
    .map(
      (it, idx) =>
        `${idx + 1}. [${it.severity}] ${it.where}\n   why: ${it.why}\n   suggestion: ${it.suggestion}`,
    )
    .join("\n");
  return [
    "# Original task",
    originalTask,
    "",
    "# Your previous artifact",
    priorArtifact,
    "",
    "# Reviewer issues to address",
    issues,
    "",
    "Produce a revised artifact that resolves every issue above.",
  ].join("\n");
}
