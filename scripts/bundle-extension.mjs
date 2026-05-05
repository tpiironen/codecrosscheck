// Bundles the VS Code extension entrypoint into a single dist/extension.js
// with all runtime deps inlined, so the .vsix doesn't depend on node_modules
// being shipped. Run after `tsc` (which still produces the per-file output
// the CLI and tests use) — this overwrites only dist/extension.js.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "src/extension.ts")],
  outfile: path.join(root, "dist/extension.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",        // VS Code extension host loads CommonJS; .cjs override
                        // sidesteps the package "type": "module" default.
  target: "node20",
  external: ["vscode"], // provided by the host
  sourcemap: true,
  logLevel: "info",
  // Keep the bundle readable enough to debug from the extension host log.
  minify: false,
  // The source uses `import.meta.url` (e.g. agents.ts -> prompts dir). In a
  // CJS bundle that becomes empty, so route it through a banner-injected
  // identifier that resolves to the bundle file's URL at runtime.
  define: {
    "import.meta.url": "__importMetaUrl",
  },
  banner: {
    js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
});
