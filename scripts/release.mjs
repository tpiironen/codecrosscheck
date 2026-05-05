#!/usr/bin/env node
// Release gate: refuses to publish unless tree is clean, branch is main, and
// the configured npm registry matches the Azure Artifacts pattern.
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

const status = git("status --porcelain");
if (status) fail(`working tree not clean:\n${status}`);

const branch = git("rev-parse --abbrev-ref HEAD");
if (branch !== "main") fail(`refusing to release from branch "${branch}" (expected main)`);

const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
const registry = pkg.publishConfig?.registry ?? "";
const expected = /^https:\/\/pkgs\.dev\.azure\.com\/[^/]+\/_packaging\/codecrosscheck-npm\/npm\/registry\/?$/;
if (!expected.test(registry)) {
  fail(
    `publishConfig.registry must point at the Azure Artifacts codecrosscheck-npm feed. Got: ${registry || "(unset)"}`,
  );
}
if (pkg.name !== "codecrosscheck") {
  fail(`package name must be "codecrosscheck" (got ${pkg.name})`);
}

console.log(`release: gates pass — version ${pkg.version}, branch ${branch}`);
console.log("release: run `npm publish` from this checkout to ship.");
