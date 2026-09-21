#!/usr/bin/env node
// Release gate for local-only distribution: refuses to package unless the tree
// is clean, the branch is main, the package name is intact, and `npm run
// verify` is green. It publishes nothing — the extension is packaged with
// `vsce` and installed from the resulting .vsix (see README).
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

// Argument arrays, never an interpolated command string: a shell-interpreted
// release script is the one place a stray character rewrites the release.
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false });
  if (r.error) fail(`${cmd} ${args.join(" ")} could not be run: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed: ${(r.stderr || "").trim()}`);
  return r.stdout.trim();
}

function runInherit(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status ?? 1;
}

const status = capture("git", ["status", "--porcelain"]);
if (status) fail(`working tree not clean:\n${status}`);

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") fail(`refusing to release from branch "${branch}" (expected main)`);

const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
if (pkg.name !== "codecrosscheck") {
  fail(`package name must be "codecrosscheck" (got ${pkg.name})`);
}
// Distribution is local-only: nothing is published to a registry, and `private`
// is what stops an accidental `npm publish` from making that untrue.
if (pkg.private !== true) {
  fail('package.json must set "private": true while distribution is local-only');
}

if (runInherit("npm", ["run", "verify"]) !== 0) {
  fail("npm run verify failed");
}

console.log(`release: gates pass — version ${pkg.version}, branch ${branch}`);
console.log("release: package with `npx vsce package --no-dependencies`, then");
console.log(`release: install with \`code --install-extension codecrosscheck-${pkg.version}.vsix\`.`);
