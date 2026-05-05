#!/usr/bin/env node
/**
 * One-liner installer for the CodeCrossCheck VS Code extension and its
 * delegation skill.
 *
 *   npx codecrosscheck-install                # install VSIX
 *   npx codecrosscheck-install skill          # install delegation skill (workspace scope)
 *   npx codecrosscheck-install skill --user   # install to ~/.agents/skills/ instead
 *
 * Downloads the matching .vsix from the Azure Artifacts universal feed and
 * runs `code --install-extension`. Requires `az` CLI authenticated against the
 * org and `code` on PATH.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const FEED = process.env.CCC_UNIVERSAL_FEED ?? "codecrosscheck-universal";
const PACKAGE_NAME = process.env.CCC_VSIX_PACKAGE ?? "codecrosscheck-vsix";
const VERSION = process.env.CCC_VSIX_VERSION ?? "*";

const SKILL_NAME = "codecrosscheck-delegate";
const SKILL_FILE = "SKILL.md";

function which(cmd: string): boolean {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

function run(cmd: string, args: string[]): number {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status ?? 1;
}

function bundledSkillPath(): string {
  // dist/install.js -> dist/assets/skills/<name>/SKILL.md
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "assets", "skills", SKILL_NAME, SKILL_FILE);
}

function installSkill(scope: "workspace" | "user"): number {
  const src = bundledSkillPath();
  if (!fs.existsSync(src)) {
    console.error(`Bundled skill not found at ${src}. Reinstall the package or run \`npm run build\`.`);
    return 2;
  }

  const destBase = scope === "workspace"
    ? path.join(process.cwd(), ".github", "skills")
    : path.join(os.homedir(), ".agents", "skills");
  const destDir = path.join(destBase, SKILL_NAME);
  const dest = path.join(destDir, SKILL_FILE);

  if (fs.existsSync(dest)) {
    console.error(`Refusing to overwrite existing skill at ${dest}. Delete it first if you want to reinstall.`);
    return 3;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Installed delegation skill -> ${dest}`);
  console.log("Restart VS Code (or reload the chat extension) for the skill to be discovered.");
  return 0;
}

function installVsix(): number {
  if (!which("code")) {
    console.error("`code` CLI not found on PATH. Install VS Code or enable the `code` command first.");
    return 2;
  }
  if (!which("az")) {
    console.error("`az` CLI not found on PATH. Install Azure CLI and run `az login` first.");
    return 2;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-install-"));
  console.log(`Downloading ${PACKAGE_NAME}@${VERSION} from feed ${FEED} into ${tmp}…`);
  const dl = run("az", [
    "artifacts",
    "universal",
    "download",
    "--feed",
    FEED,
    "--name",
    PACKAGE_NAME,
    "--version",
    VERSION,
    "--path",
    tmp,
  ]);
  if (dl !== 0) {
    console.error("Universal download failed.");
    return dl;
  }

  const vsix = fs.readdirSync(tmp).find((f) => f.endsWith(".vsix"));
  if (!vsix) {
    console.error(`No .vsix file found in ${tmp}.`);
    return 3;
  }
  const vsixPath = path.join(tmp, vsix);
  console.log(`Installing ${vsixPath}…`);
  return run("code", ["--install-extension", vsixPath]);
}

function main(): number {
  const args = process.argv.slice(2);
  if (args[0] === "skill") {
    const scope: "workspace" | "user" = args.includes("--user") ? "user" : "workspace";
    return installSkill(scope);
  }
  return installVsix();
}

process.exit(main());
