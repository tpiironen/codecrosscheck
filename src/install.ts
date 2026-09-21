#!/usr/bin/env node
/**
 * Installer for the CodeCrossCheck delegation skill.
 *
 *   npx codecrosscheck-install skill          # install delegation skill (workspace scope)
 *   npx codecrosscheck-install skill --user   # install to ~/.agents/skills/ instead
 *
 * The extension itself is built and installed from a clone; see the README.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "codecrosscheck-delegate";
const SKILL_FILE = "SKILL.md";

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

function usage(): number {
  console.error(
    [
      "Usage: codecrosscheck-install skill [--user]",
      "",
      "Installs the CodeCrossCheck delegation skill.",
      "  (default)  .github/skills/ in the current workspace",
      "  --user     ~/.agents/skills/",
      "",
      "To install the extension itself, build it from a clone:",
      "  npm ci && npm run build",
      "  npx vsce package --no-dependencies",
      "  code --install-extension codecrosscheck-<version>.vsix",
    ].join("\n"),
  );
  return 2;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args[0] === "skill") {
    const scope: "workspace" | "user" = args.includes("--user") ? "user" : "workspace";
    return installSkill(scope);
  }
  return usage();
}

process.exit(main());
