import { describe, it, expect } from "vitest";
import { runSandboxed } from "../src/sandbox.js";

describe("sandbox", () => {
  it("runs a node script and returns stdout", async () => {
    const r = await runSandboxed("console.log('hello')", { language: "node", timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello");
  });

  it("times out and reports nonzero exit", async () => {
    const r = await runSandboxed("setInterval(() => {}, 100)", {
      language: "node",
      timeoutMs: 500,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.timedOut).toBe(true);
  });

  it("captures nonzero exit code from thrown error", async () => {
    const r = await runSandboxed("process.exit(7)", { language: "node", timeoutMs: 10_000 });
    expect(r.exitCode).toBe(7);
  });

  it("injects no proxy-bypass variables", async () => {
    // NO_PROXY tells clients to *bypass* a proxy; it denies nothing, so the
    // sandbox must not set it and pretend it is a network control.
    const r = await runSandboxed(
      "console.log(JSON.stringify({ no: process.env.NO_PROXY ?? null, lower: process.env.no_proxy ?? null }))",
      { language: "node", timeoutMs: 10_000 },
    );
    expect(JSON.parse(r.stdout.trim())).toEqual({ no: null, lower: null });
  });

  it("passes through only allowlisted environment variables", async () => {
    process.env.CCC_SANDBOX_LEAK_PROBE = "should-not-appear";
    try {
      const r = await runSandboxed(
        "console.log(process.env.CCC_SANDBOX_LEAK_PROBE ?? 'absent')",
        { language: "node", timeoutMs: 10_000 },
      );
      expect(r.stdout.trim()).toBe("absent");
    } finally {
      delete process.env.CCC_SANDBOX_LEAK_PROBE;
    }
  });
});
