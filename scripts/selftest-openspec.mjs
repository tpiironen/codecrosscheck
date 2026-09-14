#!/usr/bin/env node
/**
 * OpenSpec self-test: runs the built CLI in `--openspec` mode against a
 * tiny synthetic change (`add-sha256-cli`) that fits inside free-tier
 * model token budgets. Exercises the loader, change-frame injection,
 * `openspec validate --strict` pre-gate, worker, reviewer, and JSONL
 * transcript on a target we have ground truth for.
 *
 *   CODECROSSCHECK_BASE_URL=https://api.openai.com/v1 npm run selftest:openspec
 *
 * Skips (exit 0) when no endpoint is configured; exits 0 iff the plan stage
 * was approved within --max-iters.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CHANGE_ID = "add-sha256-cli";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.CODECROSSCHECK_BASE_URL) {
  console.log(
    "selftest:openspec: skipped — CODECROSSCHECK_BASE_URL is not set. " +
      "Point it at an OpenAI-compatible API root to run this live harness.",
  );
  process.exit(0);
}

const cliPath = path.join(repoRoot, "dist", "cli.js");
if (!fs.existsSync(cliPath)) {
  console.error(`selftest:openspec: ${cliPath} not found. Run \`npm run build\` first.`);
  process.exit(2);
}

const changeDir = path.join(repoRoot, "openspec", "changes", CHANGE_ID);
if (!fs.existsSync(changeDir)) {
  console.error(`selftest:openspec: fixture change missing: ${changeDir}`);
  process.exit(2);
}

const workerModel = process.env.CCC_WORKER_MODEL ?? "openai/gpt-4o-mini";
const reviewerModel = process.env.CCC_REVIEWER_MODEL ?? "openai/gpt-4o-mini";

const args = [
  cliPath,
  "Draft a one-page implementation plan for the sha256-cli capability described in the OpenSpec change frame. Include verification steps that match the spec's scenarios.",
  "--openspec",
  CHANGE_ID,
  "--stages",
  "plan",
  "--max-iters",
  "2",
  "--worker-model",
  workerModel,
  "--reviewer-model",
  reviewerModel,
];

console.log(`selftest:openspec: node ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`);

const r = spawnSync(process.execPath, args, {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (r.status === 0) {
  console.log("\nselftest:openspec: plan stage approved.");
} else {
  console.log(`\nselftest:openspec: plan stage NOT approved (exit ${r.status}). See the JSONL transcript above for issues.`);
}
process.exit(r.status ?? 1);
