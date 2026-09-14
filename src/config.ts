/**
 * Single source of truth for `codecrosscheck.*` settings.
 *
 * Every default here must match the value contributed in `package.json`;
 * `test/config.test.ts` asserts that. Handlers read settings through
 * `readConfig` rather than restating defaults inline — four hand-copied
 * resolution blocks are how the reviewer fallback came to name the worker's
 * own vendor.
 */
import type * as vscode from "vscode";
import { VscodeLmClient } from "./clients/vscodeLm.js";

export const DEFAULTS = {
  workerModel: "anthropic/claude-opus-5",
  reviewerModel: "openai/gpt-5.3-codex",
  useChatPickerWorker: true,
  maxIters: 6,
  "reviewBranch.maxDiffChars": 1_100_000,
  "reviewBranch.keepTranscripts": 50,
  "execute.timeoutMs": 30_000,
  "applyReview.testCommand": "",
  "applyReview.buildCommand": "",
  "applyReview.buildTimeoutMs": 300_000,
  "applyReview.dryRun": false,
} as const;

export interface ResolvedConfig {
  workerModel: string;
  reviewerModel: string;
  useChatPickerWorker: boolean;
  maxIters: number;
  maxDiffChars: number;
  keepTranscripts: number;
  executeTimeoutMs: number;
  testCommand: string;
  buildCommand: string;
  buildTimeoutMs: number;
  dryRun: boolean;
}

/** Minimal shape of `vscode.WorkspaceConfiguration`, so this module is testable. */
export interface ConfigSource {
  get<T>(section: string): T | undefined;
}

function str(cfg: ConfigSource, key: keyof typeof DEFAULTS, deprecatedOverride?: string): string {
  const override = deprecatedOverride ? (cfg.get<string>(deprecatedOverride) ?? "").trim() : "";
  if (override) return override;
  const value = (cfg.get<string>(key) ?? "").trim();
  return value || (DEFAULTS[key] as string);
}

function num(cfg: ConfigSource, key: keyof typeof DEFAULTS): number {
  const value = cfg.get<number>(key);
  return typeof value === "number" && Number.isFinite(value) ? value : (DEFAULTS[key] as number);
}

function bool(cfg: ConfigSource, key: keyof typeof DEFAULTS): boolean {
  const value = cfg.get<boolean>(key);
  return typeof value === "boolean" ? value : (DEFAULTS[key] as boolean);
}

export function readConfig(cfg: ConfigSource): ResolvedConfig {
  return {
    workerModel: str(cfg, "workerModel", "workerModelOverride"),
    reviewerModel: str(cfg, "reviewerModel", "reviewerModelOverride"),
    useChatPickerWorker: bool(cfg, "useChatPickerWorker"),
    maxIters: num(cfg, "maxIters"),
    maxDiffChars: num(cfg, "reviewBranch.maxDiffChars"),
    keepTranscripts: num(cfg, "reviewBranch.keepTranscripts"),
    executeTimeoutMs: num(cfg, "execute.timeoutMs"),
    testCommand: (cfg.get<string>("applyReview.testCommand") ?? "").trim(),
    buildCommand: (cfg.get<string>("applyReview.buildCommand") ?? "").trim(),
    buildTimeoutMs: num(cfg, "applyReview.buildTimeoutMs"),
    dryRun: bool(cfg, "applyReview.dryRun"),
  };
}

/** `vscode.lm` selects on `family` alone; convert "anthropic/claude-opus-5" -> "claude-opus-5". */
export function stripVendor(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

export interface ResolvedClients {
  worker: VscodeLmClient;
  reviewer: VscodeLmClient;
  /** True when both resolved to the same model, collapsing the cross-vendor guarantee. */
  sameModel: boolean;
}

/**
 * Worker prefers the model picked in the Chat model picker so the participant
 * respects the user's selection; the reviewer stays configuration-driven so it
 * remains a genuinely different model.
 */
export function resolveClients(
  config: ResolvedConfig,
  requestModel: vscode.LanguageModelChat | undefined,
): ResolvedClients {
  const worker =
    config.useChatPickerWorker && requestModel
      ? new VscodeLmClient({ family: requestModel.family, model: requestModel as unknown as never })
      : new VscodeLmClient({ family: stripVendor(config.workerModel) });
  const reviewer = new VscodeLmClient({ family: stripVendor(config.reviewerModel) });
  return { worker, reviewer, sameModel: worker.modelId === reviewer.modelId };
}
