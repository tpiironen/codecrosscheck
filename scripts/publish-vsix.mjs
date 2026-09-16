#!/usr/bin/env node
// Builds the VSIX with vsce, then publishes it to the codecrosscheck-universal
// Azure Artifacts feed.
import { execSync } from "node:child_process";
import * as fs from "node:fs";

const FEED = process.env.CCC_UNIVERSAL_FEED ?? "codecrosscheck-universal";
const PACKAGE_NAME = process.env.CCC_VSIX_PACKAGE ?? "codecrosscheck-vsix";

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run("npx vsce package --no-dependencies");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
// Name the artifact explicitly: the directory holds older .vsix files and a
// readdir scan returns the alphabetically-first one, not the one just built.
const vsix = `${pkg.name}-${pkg.version}.vsix`;
if (!fs.existsSync(vsix)) {
  console.error(`publish-vsix: expected ${vsix} but vsce did not produce it.`);
  process.exit(1);
}

run(
  `az artifacts universal publish --feed ${FEED} --name ${PACKAGE_NAME} --version ${pkg.version} --description "CodeCrossCheck VS Code extension" --path ${vsix}`,
);

console.log(`published ${vsix} to ${FEED}/${PACKAGE_NAME}@${pkg.version}`);
