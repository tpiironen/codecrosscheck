import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ChatClient, ChatMessage } from "./clients/ChatClient.js";
import { VerdictSchema, type Stage, type Verdict } from "./schemas.js";

const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "prompts");

function loadPrompt(stage: Stage, role: "worker" | "reviewer"): string {
  const file = path.join(PROMPTS_DIR, `${stage}_${role}.md`);
  return fs.readFileSync(file, "utf8");
}

/** Load a prompt by raw filename (without `.md`), e.g. `review_branch_fixer`. */
export function loadPromptByName(name: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
}

/** Build a worker with a caller-provided system prompt (used outside the Stage pipeline). */
export function buildWorkerWithPrompt(system: string, client: ChatClient): Worker {
  return {
    modelId: client.modelId,
    async produce(input: string): Promise<string> {
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: input },
      ];
      return client.sendText(messages);
    },
  };
}

export interface Worker {
  readonly modelId: string;
  produce(input: string): Promise<string>;
}

export interface Reviewer {
  readonly modelId: string;
  judge(artifact: string): Promise<Verdict>;
}

const WorkerOutputSchema = z.object({
  artifact: z.string().min(1),
});

export function buildWorker(stage: Stage, client: ChatClient): Worker {
  const system = loadPrompt(stage, "worker");
  return {
    modelId: client.modelId,
    async produce(input: string): Promise<string> {
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: input },
      ];
      const result = await client.sendStructured(messages, WorkerOutputSchema, "WorkerOutput");
      return result.artifact;
    },
  };
}

export function buildReviewer(stage: Stage, client: ChatClient): Reviewer {
  const system = loadPrompt(stage, "reviewer");
  return {
    modelId: client.modelId,
    async judge(artifact: string): Promise<Verdict> {
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: artifact },
      ];
      return client.sendStructured(messages, VerdictSchema, "Verdict");
    },
  };
}
