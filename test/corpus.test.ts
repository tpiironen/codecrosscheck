/**
 * Live-mode reviewer corpus harness.
 *
 * Skipped entirely unless RUN_LIVE_TESTS=1 (and, for non-validator cases, an
 * OpenAI-compatible endpoint is configured via CODECROSSCHECK_BASE_URL). For
 * each subdirectory under test/corpus, the harness loads expected.json and
 * either:
 *   - calls the corresponding reviewer agent against artifact.{ts,md,mjs,…}
 *     (or against {artifact, sandboxResult} for execute cases), OR
 *   - asserts that `openspec validate --strict` rejects the case for openspec
 *     fixtures with `expectValidatorFailure: true`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewer } from "../src/agents.js";
import { OpenAiCompatibleClient, BASE_URL_ENV, resolveBaseUrl } from "../src/clients/openaiCompatible.js";
import type { Stage, Verdict } from "../src/schemas.js";

const RUN = process.env.RUN_LIVE_TESTS === "1";
const HAS_ENDPOINT = Boolean(resolveBaseUrl());
const REVIEWER_MODEL = process.env.CCC_REVIEWER_MODEL ?? "openai/gpt-5.3-codex";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_ROOT = path.resolve(HERE, "corpus");

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

interface ExpectedIssue {
  severityAtLeast: "low" | "medium" | "high";
  whereContains: string;
}
interface Expected {
  stage: Stage | "openspec-validate";
  minVerdict: "approve" | "revise";
  expectValidatorFailure?: boolean;
  sandboxResult?: { stdout: string; stderr: string; exitCode: number };
  issues: ExpectedIssue[];
}

function discoverCases(): { dir: string; name: string; expected: Expected }[] {
  if (!fs.existsSync(CORPUS_ROOT)) return [];
  const out: { dir: string; name: string; expected: Expected }[] = [];
  const groups = fs.readdirSync(CORPUS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const g of groups) {
    const groupDir = path.join(CORPUS_ROOT, g.name);
    const cases = fs.readdirSync(groupDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const c of cases) {
      const expectedPath = path.join(groupDir, c.name, "expected.json");
      if (!fs.existsSync(expectedPath)) continue;
      const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as Expected;
      out.push({ dir: path.join(groupDir, c.name), name: `${g.name}/${c.name}`, expected });
    }
  }
  return out;
}

function loadArtifact(dir: string): string {
  const candidates = ["artifact.ts", "artifact.md", "artifact.mjs", "artifact.py", "artifact.sh"];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  // Fallback: use proposal.md if present (openspec cases).
  const proposal = path.join(dir, "proposal.md");
  if (fs.existsSync(proposal)) return fs.readFileSync(proposal, "utf8");
  throw new Error(`No artifact file found in ${dir}`);
}

function assertVerdictMatches(verdict: Verdict, expected: Expected): void {
  expect(verdict.verdict).toBe(expected.minVerdict);
  for (const exp of expected.issues) {
    const match = verdict.issues.find(
      (it) =>
        SEVERITY_RANK[it.severity] >= SEVERITY_RANK[exp.severityAtLeast] &&
        it.where.toLowerCase().includes(exp.whereContains.toLowerCase()),
    );
    expect(
      match,
      `expected an issue ${exp.severityAtLeast}+ where contains "${exp.whereContains}", got ${JSON.stringify(verdict.issues)}`,
    ).toBeDefined();
  }
}

const cases = discoverCases();

// A permanently inert gate must not read as a passing one: say why it skipped.
if (!RUN) {
  const reason = HAS_ENDPOINT
    ? "RUN_LIVE_TESTS is not 1"
    : `RUN_LIVE_TESTS is not 1 and ${BASE_URL_ENV} is not set`;
  console.warn(
    `[corpus] Skipping ${cases.length} planted-flaw case(s): ${reason}. ` +
      `This is the only gate on reviewer prompt behaviour — run it with ` +
      `RUN_LIVE_TESTS=1 ${BASE_URL_ENV}=<api-root> npx vitest run test/corpus.test.ts`,
  );
}

describe.skipIf(!RUN)("planted-flaw corpus", () => {
  for (const c of cases) {
    it(c.name, async () => {
      if (c.expected.stage === "openspec-validate") {
        // Validator-only case — handled by a sibling test below.
        return;
      }
      if (!HAS_ENDPOINT) {
        throw new Error(`${BASE_URL_ENV} required for non-validator corpus cases`);
      }
      const client = new OpenAiCompatibleClient({ modelId: REVIEWER_MODEL });
      const reviewer = buildReviewer(c.expected.stage, client);
      const artifact = loadArtifact(c.dir);
      const input =
        c.expected.stage === "execute" && c.expected.sandboxResult
          ? `${artifact}\n\n# Sandbox result\n${JSON.stringify(c.expected.sandboxResult, null, 2)}`
          : artifact;
      const verdict = await reviewer.judge(input);
      assertVerdictMatches(verdict, c.expected);
    }, 60_000);
  }
});
