import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Smoke test for the bundled VS Code extension entrypoint produced by
// scripts/bundle-extension.mjs. Catches the regression that shipped 0.2.0
// with no inlined deps: the `.vsix` activated, then immediately threw
// `Cannot find package 'zod'` because vsce respected the `"files"` field
// and didn't ship node_modules. A self-contained bundle is the contract;
// this test asserts it.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(root, "dist", "extension.cjs");

describe("extension bundle", () => {
  it("exists at dist/extension.cjs", () => {
    expect(fs.existsSync(bundlePath)).toBe(true);
  });

  it("is self-contained — no `require('zod' | 'commander' | 'undici')`", () => {
    const src = fs.readFileSync(bundlePath, "utf8");
    // The runtime deps must be inlined. The only `require` calls left
    // should be for node:* builtins and 'vscode' (declared external).
    const externalImports = [
      /require\(["']zod["']\)/,
      /require\(["']commander["']\)/,
      /require\(["']undici["']\)/,
      /require\(["']zod-to-json-schema["']\)/,
    ];
    for (const re of externalImports) {
      expect(src, `bundle still references ${re.source}`).not.toMatch(re);
    }
  });

  it("loads under Node and exports activate()", () => {
    // Run in a fresh Node process. The bundle requires 'vscode' at the top
    // level (it's marked external so the host provides it). Stub the module
    // via Module._cache before loading.
    const probe = `
      const Module = require("module");
      const stubPath = require.resolve("module"); // any cache key is fine
      Module._cache[stubPath + "::vscode-stub"] = { exports: {} };
      const origResolve = Module._resolveFilename;
      Module._resolveFilename = function (req, parent, ...rest) {
        if (req === "vscode") return stubPath + "::vscode-stub";
        return origResolve.call(this, req, parent, ...rest);
      };
      const mod = require(${JSON.stringify(bundlePath)});
      if (typeof mod.activate !== "function") {
        throw new Error("activate is not a function");
      }
      if (typeof mod.deactivate !== "function") {
        throw new Error("deactivate is not a function");
      }
      console.log("ok");
    `;
    const out = execFileSync(process.execPath, ["-e", probe], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out.trim()).toBe("ok");
  });
});
