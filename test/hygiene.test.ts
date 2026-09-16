import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
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
