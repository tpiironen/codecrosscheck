import { spawn } from "node:child_process";

export interface ValidateResult {
  ok: boolean;
  output: string;
}

/**
 * Runs `openspec validate <changeId> --strict` via spawn. Never throws — a missing
 * CLI is reported as `{ ok: false, output: "..." }` so the caller can synthesize a
 * structured reviewer verdict instead.
 */
export async function validateStrict(
  changeId: string,
  cwd: string = process.cwd(),
): Promise<ValidateResult> {
  return new Promise<ValidateResult>((resolve) => {
    // Restrict changeId to a directory-name-safe character set so it is
    // safe to pass through `shell: true` on Windows below.
    if (!/^[A-Za-z0-9._-]+$/.test(changeId)) {
      resolve({
        ok: false,
        output: `Refusing to invoke openspec with unsafe changeId: ${JSON.stringify(changeId)}`,
      });
      return;
    }

    // On Windows, the `openspec` binary is a `.cmd` shim, which Node 22+
    // refuses to spawn without `shell: true` (CVE-2024-27980 hardening).
    // The arguments here are literals plus a changeId validated above, so
    // shell injection is not a concern. We accept the DEP0190 warning.
    const child = spawn("openspec", ["validate", changeId, "--strict"], {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
    });

    child.on("error", (err) => {
      const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? "openspec CLI not found on PATH — install via `npm i -g @open-spec/cli` (or your project's preferred location)."
        : `openspec invocation failed: ${err.message}`;
      resolve({ ok: false, output: msg });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, output: buf });
    });
  });
}
