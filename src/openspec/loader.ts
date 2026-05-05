import * as fs from "node:fs";
import * as path from "node:path";

export interface SpecDelta {
  capability: string;
  body: string;
}

export interface OpenSpecChange {
  changeId: string;
  changeDir: string;
  proposal: string;
  tasks: string;
  specDeltas: SpecDelta[];
}

/** Walk up from `startDir` looking for an `openspec/` directory. */
export function findOpenSpecRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, "openspec");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadChange(changeId: string, startDir: string = process.cwd()): OpenSpecChange {
  const openspec = findOpenSpecRoot(startDir);
  if (!openspec) {
    throw new Error(`No openspec/ directory found above ${startDir}.`);
  }
  const changeDir = path.join(openspec, "changes", changeId);
  if (!fs.existsSync(changeDir) || !fs.statSync(changeDir).isDirectory()) {
    throw new Error(`OpenSpec change directory not found: ${changeDir}`);
  }
  const proposalPath = path.join(changeDir, "proposal.md");
  if (!fs.existsSync(proposalPath)) {
    throw new Error(`Missing proposal.md in change directory: ${changeDir}`);
  }
  const tasksPath = path.join(changeDir, "tasks.md");

  const specsRoot = path.join(changeDir, "specs");
  const specDeltas: SpecDelta[] = [];
  if (fs.existsSync(specsRoot)) {
    for (const cap of fs.readdirSync(specsRoot)) {
      const specFile = path.join(specsRoot, cap, "spec.md");
      if (fs.existsSync(specFile)) {
        specDeltas.push({
          capability: cap,
          body: fs.readFileSync(specFile, "utf8"),
        });
      }
    }
  }

  return {
    changeId,
    changeDir,
    proposal: fs.readFileSync(proposalPath, "utf8"),
    tasks: fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, "utf8") : "",
    specDeltas,
  };
}

/** Brief textual frame to inject into reviewer prompts. */
export function renderChangeFrame(change: OpenSpecChange, diff?: string): string {
  const parts = [
    `# OpenSpec change frame: ${change.changeId}`,
    "",
    "## proposal.md",
    change.proposal.trim(),
    "",
    "## tasks.md",
    change.tasks.trim() || "(none)",
    "",
    "## spec deltas",
  ];
  for (const d of change.specDeltas) {
    parts.push(`### ${d.capability}`, d.body.trim(), "");
  }
  if (diff) {
    parts.push("## diff under review", "```diff", diff, "```");
  }
  return parts.join("\n");
}
