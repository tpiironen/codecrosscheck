import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type SandboxLanguage = "node" | "python" | "bash";

export interface SandboxOptions {
  language?: SandboxLanguage;
  timeoutMs?: number;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

const ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "SystemRoot", "SYSTEMROOT"];

/**
 * Runs `code` in a temp directory with an allowlisted environment and a hard
 * timeout.
 *
 * This is containment, not a security boundary: the child runs as the invoking
 * user with full filesystem access and unrestricted network. There is
 * deliberately no `allowNetwork` option — the previous implementation set
 * `NO_PROXY=*`, which tells clients to *bypass* a proxy and denies nothing.
 */
export async function runSandboxed(
  code: string,
  opts: SandboxOptions = {},
): Promise<SandboxResult> {
  const language = opts.language ?? "node";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const tmpRoot = path.join(os.tmpdir(), `ccc-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const { command, args, scriptName } = pickRunner(language);
  const scriptPath = path.join(tmpRoot, scriptName);
  fs.writeFileSync(scriptPath, code, "utf8");

  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }

  const start = Date.now();
  let timedOut = false;

  return new Promise<SandboxResult>((resolve) => {
    const child = spawn(command, [...args, scriptPath], {
      cwd: tmpRoot,
      env,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32" && child.pid !== undefined) {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // best-effort
      }
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      resolve({
        stdout,
        stderr,
        exitCode: timedOut ? code ?? -1 : code,
        durationMs,
        timedOut,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      resolve({
        stdout,
        stderr: stderr + `\n[sandbox spawn error] ${err.message}`,
        exitCode: -1,
        durationMs,
        timedOut,
      });
    });
  });
}

function pickRunner(language: SandboxLanguage): {
  command: string;
  args: string[];
  scriptName: string;
} {
  switch (language) {
    case "node":
      return { command: process.execPath, args: [], scriptName: "script.mjs" };
    case "python":
      return {
        command: process.platform === "win32" ? "python" : "python3",
        args: [],
        scriptName: "script.py",
      };
    case "bash":
      return { command: "bash", args: [], scriptName: "script.sh" };
    default:
      throw new Error(`Unsupported sandbox language: ${language as string}`);
  }
}
