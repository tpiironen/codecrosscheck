import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("source hygiene", () => {
  const files = sourceFiles(path.join(root, "src"));

  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("contains no `void <identifier>;` suppression statements", () => {
    // These existed only to silence unused-symbol warnings from compiler flags
    // that were switched off. `void token;` is how the discarded cancellation
    // token got past review.
    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*void\s+[A-Za-z_$][\w$]*\s*;\s*$/.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("carries no eslint-disable directives for unconfigured rules", () => {
    const configured = fs.readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
    const self = path.join(root, "test", "hygiene.test.ts");
    const offenders: string[] = [];
    for (const file of [...files, ...sourceFiles(path.join(root, "test"))]) {
      if (file === self) continue;
      const text = fs.readFileSync(file, "utf8");
      // Only real comment directives, not prose that happens to say the word.
      for (const m of text.matchAll(
        /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\s+([\w@/-]+)/g,
      )) {
        const rule = m[1];
        if (rule && !configured.includes(rule)) {
          offenders.push(`${path.relative(root, file)}: ${rule}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("distribution is local-only", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    private?: boolean;
    publishConfig?: unknown;
    scripts?: Record<string, string>;
  };

  // A prohibition nobody enforces is a sentence. `private` is what actually
  // stops `npm publish`; the previous guard lived in a release script that
  // rejected every invocation and so never ran.
  it("cannot be published to a registry by accident", () => {
    expect(pkg.private).toBe(true);
    expect(pkg.publishConfig).toBeUndefined();
  });

  it("offers no publish script", () => {
    const publishScripts = Object.keys(pkg.scripts ?? {}).filter((s) => s.startsWith("publish"));
    expect(publishScripts).toEqual([]);
  });
});

describe("release scripts do not shell-interpret commands", () => {
  const scripts = fs
    .readdirSync(path.join(root, "scripts"))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => path.join(root, "scripts", f));

  it("finds scripts to check", () => {
    expect(scripts.length).toBeGreaterThan(3);
  });

  // `publish-vsix.mjs` interpolated two environment variables into an
  // `execSync` command string. Argument arrays are required by the
  // `distribution` and `chat-loop` specs alike.
  it("uses no execSync", () => {
    const offenders = scripts
      .filter((f) => /\bexecSync\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});

describe("release gate", () => {
  // The previous gate was unsatisfiable and so never ran, which went unnoticed
  // through two releases. Exercise it against throwaway repositories rather
  // than asserting on its source.
  const releaseScript = path.join(root, "scripts", "release.mjs");
  const made: string[] = [];

  afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, args: string[]): void {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
  }

  function repo(
    pkg: Record<string, unknown>,
    opts: { dirty?: boolean; branch?: string } = {},
  ): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-release-"));
    made.push(dir);
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["config", "user.email", "test@example.invalid"]);
    git(dir, ["config", "user.name", "CodeCrossCheck Test"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "init"]);
    if (opts.branch) git(dir, ["checkout", "-q", "-b", opts.branch]);
    if (opts.dirty) fs.writeFileSync(path.join(dir, "stray.txt"), "dirty\n");
    return dir;
  }

  const runRelease = (cwd: string) =>
    spawnSync(process.execPath, [releaseScript], { cwd, encoding: "utf8" });

  // `verify` leaves a marker so the success path can prove it was invoked.
  const basePkg = {
    name: "codecrosscheck",
    version: "0.0.0-test",
    private: true,
    scripts: { verify: "node -e \"require('fs').writeFileSync('verify-ran','1')\"" },
  };

  it("refuses a dirty working tree", () => {
    const r = runRelease(repo(basePkg, { dirty: true }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("working tree not clean");
  });

  it("refuses a branch other than main", () => {
    const r = runRelease(repo(basePkg, { branch: "feature/x" }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("expected main");
  });

  it("refuses a manifest that is not private", () => {
    const r = runRelease(repo({ ...basePkg, private: false }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("private");
  });

  it("refuses a renamed package", () => {
    const r = runRelease(repo({ ...basePkg, name: "something-else" }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("package name");
  });

  it("runs verify on the success path and publishes nothing", () => {
    const dir = repo(basePkg);
    const r = runRelease(dir);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(dir, "verify-ran")), "gate must invoke npm run verify").toBe(
      true,
    );
    expect(r.stdout).toContain("gates pass");
    expect(r.stdout).toContain("vsce package");
    expect(r.stdout).not.toContain("npm publish");
  });
});

describe("codecrosscheck-install", () => {
  // The VSIX download path is gone; with no subcommand the bin must print the
  // documented build-and-install procedure rather than attempting anything.
  const installEntry = path.join(root, "dist", "install.js");

  it("exits non-zero with usage when given no subcommand", () => {
    expect(fs.existsSync(installEntry), "run `npm run build` first").toBe(true);
    const r = spawnSync(process.execPath, [installEntry], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Usage: codecrosscheck-install skill");
    expect(r.stderr).toContain("npx vsce package --no-dependencies");
    expect(r.stderr).not.toMatch(/\baz\b/);
  });
});

describe("contributed settings are documented", () => {
  it("gives every codecrosscheck.* setting a row in the README settings table", () => {
    // The tools.* settings shipped in 0.5.0 undocumented; this is that gap pinned.
    // Scoped to the table because prose elsewhere mentions some keys in passing,
    // which would satisfy a whole-file search without documenting the default.
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      contributes?: { configuration?: { properties?: Record<string, unknown> } };
    };
    const settings = Object.keys(pkg.contributes?.configuration?.properties ?? {});
    expect(settings.length).toBeGreaterThan(5);

    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const table = /^### Settings$([\s\S]*?)^#{2,3} /m.exec(readme)?.[1];
    expect(table, "README must have a `### Settings` section").toBeTruthy();

    const rows = new Set(
      [...table!.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]),
    );
    expect(settings.filter((key) => !rows.has(key))).toEqual([]);
  });
});

describe("reviewer prompt edition", () => {
  it("names an OWASP edition the helper can read back", async () => {
    const { reviewerOwaspEdition } = await import("../src/agents.js");
    const edition = reviewerOwaspEdition();
    expect(edition, "code_reviewer.md must name its OWASP Top 10 edition").toBeTruthy();
    expect(edition).toMatch(/^OWASP Top 10:\d{4}$/);
  });

  it("is pinned to the edition the checklist actually lists", () => {
    // Verified against owasp.org on 2026-09-11: 2025 is current, 2021 is previous.
    const prompt = fs.readFileSync(path.join(root, "src", "prompts", "code_reviewer.md"), "utf8");
    expect(prompt).toContain("OWASP Top 10:2025");
    expect(prompt).toContain("Software Supply Chain Failures");
    expect(prompt).toContain("Mishandling of Exceptional Conditions");
    // SSRF stopped being a standalone category; the note keeping it covered must stay.
    expect(prompt).toMatch(/SSRF/);
  });
});
