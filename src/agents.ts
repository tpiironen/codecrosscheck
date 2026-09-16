import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatClient, ChatMessage, SendOptions } from "./clients/ChatClient.js";
import {
  FixProposalSchema,
  VerdictSchema,
  TriageSchema,
  type FixProposal,
  type Stage,
  type Triage,
  type Verdict,
} from "./schemas.js";

const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "prompts");

function loadPrompt(stage: Stage, role: "worker" | "reviewer"): string {
  const file = path.join(PROMPTS_DIR, `${stage}_${role}.md`);
  return fs.readFileSync(file, "utf8");
}

/** Load a prompt by raw filename (without `.md`), e.g. `review_branch_fixer`. */
export function loadPromptByName(name: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
}

/**
 * The OWASP Top 10 edition the CODE reviewer checklist implements, read from
 * the prompt itself so the two cannot drift. Recorded in the transcript so a
 * past review can be audited against the list that was actually applied.
 */
export function reviewerOwaspEdition(): string | null {
  const match = loadPrompt("code", "reviewer").match(/OWASP Top 10:(\d{4})/);
  return match?.[1] ? `OWASP Top 10:${match[1]}` : null;
}

export interface Worker {
  readonly modelId: string;
  produce(input: string, opts?: SendOptions): Promise<string>;
}

export interface Reviewer {
  readonly modelId: string;
  judge(artifact: string, opts?: SendOptions): Promise<Verdict>;
}

/** Judges whether findings are real. Deliberately has no path to producing a fix. */
export interface Triager {
  readonly modelId: string;
  triage(input: string, opts?: SendOptions): Promise<Triage>;
}

/** Produces the response to a set of reviewer findings, edits included. */
export interface Fixer {
  readonly modelId: string;
  propose(input: string, opts?: SendOptions): Promise<FixProposal>;
}

function messagesFor(system: string, user: string): ChatMessage[] {
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Workers produce documents, so they reply with plain text. Wrapping Markdown
 * or code in a `{"artifact": "…"}` envelope forced the model to JSON-escape a
 * whole document into one string field, which cost tokens and pushed valid
 * answers into the schema-retry path. Reviewers stay structured.
 */
export function buildWorker(stage: Stage, client: ChatClient): Worker {
  const system = loadPrompt(stage, "worker");
  return {
    modelId: client.modelId,
    produce: (input, opts) => client.sendText(messagesFor(system, input), opts),
  };
}

export function buildReviewer(stage: Stage, client: ChatClient): Reviewer {
  const system = loadPrompt(stage, "reviewer");
  return {
    modelId: client.modelId,
    judge: (artifact, opts) =>
      client.sendStructured(messagesFor(system, artifact), VerdictSchema, "Verdict", opts),
  };
}

export function buildTriager(client: ChatClient): Triager {
  const system = loadPromptByName("finding_triage");
  return {
    modelId: client.modelId,
    triage: (input, opts) =>
      client.sendStructured(messagesFor(system, input), TriageSchema, "Triage", opts),
  };
}

export function buildFixer(client: ChatClient): Fixer {
  const system = loadPromptByName("review_branch_fixer");
  return {
    modelId: client.modelId,
    propose: (input, opts) =>
      client.sendStructured(messagesFor(system, input), FixProposalSchema, "FixProposal", opts),
  };
}
