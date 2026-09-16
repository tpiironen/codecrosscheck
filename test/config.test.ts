import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, readConfig, stripVendor, type ConfigSource } from "../src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface ManifestSetting {
  default?: unknown;
  scope?: string;
  enum?: unknown[];
}

function manifestSettings(): Record<string, ManifestSetting> {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    contributes: { configuration: { properties: Record<string, ManifestSetting> } };
  };
  return pkg.contributes.configuration.properties;
}

/** ConfigSource backed by a plain object, mirroring WorkspaceConfiguration.get. */
function source(values: Record<string, unknown>): ConfigSource {
  return { get: <T,>(section: string) => values[section] as T | undefined };
}

describe("config defaults match the extension manifest", () => {
  const props = manifestSettings();

  for (const key of Object.keys(DEFAULTS)) {
    it(`codecrosscheck.${key}`, () => {
      const contributed = props[`codecrosscheck.${key}`];
      expect(contributed, `codecrosscheck.${key} is not contributed in package.json`).toBeDefined();
      expect(contributed!.default).toEqual(DEFAULTS[key as keyof typeof DEFAULTS]);
    });
  }
});

describe("command-executing settings are not workspace-overridable", () => {
  const props = manifestSettings();
  for (const key of ["codecrosscheck.applyReview.buildCommand", "codecrosscheck.applyReview.testCommand"]) {
    it(`${key} is machine-scoped`, () => {
      expect(props[key]?.scope).toBe("machine");
    });
  }
});

describe("model settings are free text", () => {
  const props = manifestSettings();
  for (const key of ["codecrosscheck.workerModel", "codecrosscheck.reviewerModel"]) {
    it(`${key} contributes no enum`, () => {
      expect(props[key]?.enum).toBeUndefined();
    });
  }
});

describe("readConfig", () => {
  it("falls back to the declared defaults when nothing is set", () => {
    const cfg = readConfig(source({}));
    expect(cfg.workerModel).toBe(DEFAULTS.workerModel);
    expect(cfg.reviewerModel).toBe(DEFAULTS.reviewerModel);
    expect(cfg.maxIters).toBe(DEFAULTS.maxIters);
  });

  it("never falls the reviewer back to the worker's default family", () => {
    const cfg = readConfig(source({}));
    expect(cfg.reviewerModel).not.toBe(DEFAULTS.workerModel);
  });

  it("honours the deprecated override settings", () => {
    const cfg = readConfig(
      source({
        workerModel: "openai/gpt-x",
        workerModelOverride: "  anthropic/claude-y  ",
      }),
    );
    expect(cfg.workerModel).toBe("anthropic/claude-y");
  });

  it("ignores a blank override", () => {
    const cfg = readConfig(source({ workerModel: "openai/gpt-x", workerModelOverride: "   " }));
    expect(cfg.workerModel).toBe("openai/gpt-x");
  });

  it("trims commands", () => {
    const cfg = readConfig(source({ "applyReview.buildCommand": "  npm run build  " }));
    expect(cfg.buildCommand).toBe("npm run build");
  });
});

describe("stripVendor", () => {
  it("drops the vendor prefix", () => {
    expect(stripVendor("openai/gpt-5.4")).toBe("gpt-5.4");
  });
  it("passes a bare family through", () => {
    expect(stripVendor("gpt-5.4")).toBe("gpt-5.4");
  });
});

describe("extension manifest declares its trust posture", () => {
  it("has an explicit untrustedWorkspaces capability", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      capabilities?: { untrustedWorkspaces?: { supported?: unknown; description?: string } };
    };
    expect(pkg.capabilities?.untrustedWorkspaces?.supported).toBeDefined();
    expect(pkg.capabilities?.untrustedWorkspaces?.description).toBeTruthy();
  });
});
