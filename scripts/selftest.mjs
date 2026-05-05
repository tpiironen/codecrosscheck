#!/usr/bin/env node
/**
 * Self-test: runs the built CLI in PLAN-only mode against a small synthetic
 * task. Exercises CLI entry point, token resolution (GITHUB_TOKEN or `gh
 * auth token`), worker -> reviewer loop, JSON verdict parsing, JSONL
 * transcript, and process lifecycle / undici cleanup.
 *
 * This selftest does NOT exercise `--openspec` mode (loader, diff,
 * change-frame injection, validator pre-gate). For that, run
 * `npm run selftest:openspec`, which targets the small `add-sha256-cli`
 * fixture change that fits inside free-tier token budgets.
 *
 *   GITHUB_TOKEN=ghp_xxx npm run selftest
 *
 * Exits 0 iff the plan stage was approved within --max-iters.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CHANGE_ID = "add-codecrosscheck";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasToken() {
  if (process.env.GITHUB_TOKEN) return true;
  const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

if (!hasToken()) {
  console.error(
    "selftest: no GitHub token available. Set GITHUB_TOKEN or run `gh auth login` first.",
  );
  process.exit(2);
}

const cliPath = path.join(repoRoot, "dist", "cli.js");
if (!fs.existsSync(cliPath)) {
  console.error(`selftest: ${cliPath} not found. Run \`npm run build\` first.`);
  process.exit(2);
}

const changeDir = path.join(repoRoot, "openspec", "changes", CHANGE_ID);
if (!fs.existsSync(changeDir)) {
  console.error(`selftest: OpenSpec change directory missing: ${changeDir}`);
  process.exit(2);
}

// GitHub Models free tier caps request bodies for some models (gpt-5 = 4000
// tokens, gpt-4o-mini = 8000 tokens). Use a compact model for selftest by
// default; users with larger allowances can override via env.
const workerModel = process.env.CCC_WORKER_MODEL ?? "openai/gpt-4o-mini";
const reviewerModel = process.env.CCC_REVIEWER_MODEL ?? "openai/gpt-4o-mini";

// Selftest does NOT pass --openspec on purpose: this repo's own change is
// ~12K tokens which exceeds free-tier request budgets. The OpenSpec frame
// integration is already covered by unit tests. To dogfood OpenSpec mode
// against a smaller change, run the CLI directly with a paid-tier model.
const args = [
  cliPath,
  "Draft a one-page implementation plan for a tiny CLI tool that prints the SHA-256 of stdin in 5 lines of TypeScript. Include verification steps.",
  "--stages",
  "plan",
  "--max-iters",
  "2",
  "--worker-model",
  workerModel,
  "--reviewer-model",
  reviewerModel,
];

console.log(`selftest: node ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n`);

const r = spawnSync(process.execPath, args, {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (r.status === 0) {
  console.log("\nselftest: plan stage approved.");
} else {
  console.log(`\nselftest: plan stage NOT approved (exit ${r.status}). See the JSONL transcript above for issues.`);
}
process.exit(r.status ?? 1);
