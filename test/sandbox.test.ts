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
});
