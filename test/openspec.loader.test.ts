import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findOpenSpecRoot, loadChange, renderChangeFrame } from "../src/openspec/loader.js";

describe("openspec loader", () => {
  let root: string;
  let changeDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-os-"));
    changeDir = path.join(root, "openspec", "changes", "add-foo");
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, "proposal.md"), "# add-foo\n\n## Why\nReasons.\n");
    fs.writeFileSync(path.join(changeDir, "tasks.md"), "# Tasks\n- [ ] 1.1 do it\n");
    const specs = path.join(changeDir, "specs", "foo");
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(path.join(specs, "spec.md"), "## ADDED Requirements\nThing.\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("findOpenSpecRoot walks up to locate openspec/", () => {
    const nested = path.join(root, "deep", "nested");
    fs.mkdirSync(nested, { recursive: true });
    expect(findOpenSpecRoot(nested)).toBe(path.join(root, "openspec"));
  });

  it("loadChange returns proposal/tasks/specDeltas", () => {
    const change = loadChange("add-foo", root);
    expect(change.proposal).toContain("add-foo");
    expect(change.tasks).toContain("1.1");
    expect(change.specDeltas.length).toBeGreaterThan(0);
  });

  it("renderChangeFrame includes change id and proposal", () => {
    const change = loadChange("add-foo", root);
    const frame = renderChangeFrame(change);
    expect(frame).toContain("add-foo");
    expect(frame).toContain("Reasons");
  });
});
