import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getChangeDiff } from "../src/openspec/diff.js";

/**
 * Exercises `getChangeDiff` against a real repository. The behaviour under test
 * — that a review covers uncommitted work — cannot be verified without git.
 */
let repo: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-diff-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "user.name", "Test"]);
  git(["config", "commit.gpgsign", "false"]);

  fs.writeFileSync(path.join(repo, "base.txt"), "base\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "base"]);

  fs.writeFileSync(path.join(repo, "committed.txt"), "committed\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "second"]);

  // Unstaged edit to a tracked file.
  fs.writeFileSync(path.join(repo, "base.txt"), "base modified in working tree\n");
  // Staged-but-uncommitted edit to a tracked file.
  fs.writeFileSync(path.join(repo, "committed.txt"), "committed then staged\n");
  git(["add", "committed.txt"]);
  // Untracked file, which must stay out of the prompt.
  fs.writeFileSync(path.join(repo, "untracked.txt"), "secrets maybe\n");
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("getChangeDiff default (working tree)", () => {
  it("includes unstaged edits to tracked files", async () => {
    const { patch } = await getChangeDiff({ cwd: repo, baseRef: "HEAD" });
    expect(patch).toContain("base modified in working tree");
  });

  it("includes staged but uncommitted edits", async () => {
    const { patch } = await getChangeDiff({ cwd: repo, baseRef: "HEAD" });
    expect(patch).toContain("committed then staged");
  });

  it("excludes untracked files", async () => {
    const { patch } = await getChangeDiff({ cwd: repo, baseRef: "HEAD" });
    expect(patch).not.toContain("untracked.txt");
  });

  it("describes the comparison as including the working tree", async () => {
    const { description } = await getChangeDiff({ cwd: repo, baseRef: "HEAD" });
    expect(description).toContain("working tree");
    expect(description).toContain("HEAD");
  });
});

describe("getChangeDiff committedOnly", () => {
  it("excludes working-tree state", async () => {
    const { patch } = await getChangeDiff({ cwd: repo, baseRef: "HEAD", committedOnly: true });
    expect(patch).not.toContain("base modified in working tree");
    expect(patch).not.toContain("committed then staged");
  });

  it("still covers the commit range", async () => {
    const { patch } = await getChangeDiff({
      cwd: repo,
      baseRef: "HEAD~1",
      committedOnly: true,
    });
    expect(patch).toContain("committed.txt");
  });

  it("describes the comparison as committed-only", async () => {
    const { description } = await getChangeDiff({ cwd: repo, baseRef: "HEAD", committedOnly: true });
    expect(description).toContain("committed changes");
    expect(description).not.toContain("working tree");
  });
});
