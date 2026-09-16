// Copies non-TS assets (prompts/ and skills/) from the repo into dist/ so they
// are resolvable relative to the built JS files when the package or VSIX runs.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function copy(srcRel, destRel, label) {
  const src = path.join(root, srcRel);
  const dest = path.join(root, destRel);
  if (!existsSync(src)) {
    console.error(`No ${label} directory found at ${src}`);
    process.exit(1);
  }
  // Clear first: cpSync merges, so a deleted source file otherwise lives on in
  // dist and ships in the VSIX.
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${label} -> ${dest}`);
}

copy("src/prompts", "dist/prompts", "prompts");
copy(".github/skills", "dist/assets/skills", "skills");
