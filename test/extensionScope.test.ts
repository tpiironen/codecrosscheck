import { describe, it, expect, vi } from "vitest";

// `src/extension.ts` touches the `vscode` namespace only inside function
// bodies, so an empty stub is enough to import it outside the extension host.
vi.mock("vscode", () => ({}));

const {
  buildScopeBlock,
  buildReviewerPrompt,
  buildTriageInput,
  buildFixerInput,
  buildRereviewInput,
  withScope,
} = await import("../src/extension.js");

const MAX_LISTED = 200;

const verdict = {
  verdict: "revise",
  summary: "s",
  issues: [{ severity: "high", where: "src/a.ts:1", why: "w", suggestion: "s" }],
} as never;

describe("buildScopeBlock", () => {
  it("names every changed path and the rule that findings must cite one", () => {
    const block = buildScopeBlock(["src/a.ts", "test/a.test.ts"]);
    expect(block).toContain("# Files under review (2 changed on this branch)");
    expect(block).toContain("- `src/a.ts`");
    expect(block).toContain("- `test/a.test.ts`");
    expect(block).toContain("Every finding MUST cite one of these paths");
    expect(block).toContain("never the subject of a finding in its own right");
  });

  it("is empty for a patch with no files, so the prompt is left untouched", () => {
    expect(buildScopeBlock([])).toBe("");
    expect(withScope("# Reviewer instructions", "")).toBe("# Reviewer instructions");
  });

  it("caps the listing and reports the remainder as a count", () => {
    const paths = Array.from({ length: MAX_LISTED + 7 }, (_, i) => `src/f${i}.ts`);
    const block = buildScopeBlock(paths);

    expect(block).toContain(`# Files under review (${MAX_LISTED + 7} changed on this branch)`);
    expect(block).toContain("further changed file(s)");
    expect(block).toContain(`- \`src/f${MAX_LISTED - 1}.ts\``);
    expect(block).not.toContain(`- \`src/f${MAX_LISTED}.ts\``);
    expect(block.split("\n").filter((l) => l.startsWith("- `")).length).toBe(MAX_LISTED);
  });
});

describe("branch-review prompts carry the scope", () => {
  const scopeBlock = buildScopeBlock(["src/a.ts", "test/a.test.ts"]);
  const scopedTaskHeader = withScope("# Reviewer instructions\nReview it.", scopeBlock);

  it("reaches the reviewer's first-pass prompt", () => {
    const prompt = buildReviewerPrompt({
      taskHeader: scopedTaskHeader,
      diffBlock: "# Branch diff (x)",
      attachedBlock: "",
    });
    expect(prompt).toContain(scopeBlock);
    expect(prompt).toContain("# Branch diff (x)");
  });

  it("reaches the triager", () => {
    const input = buildTriageInput({ verdict, diffDescription: "a branch", scopeBlock });
    expect(input).toContain(scopeBlock);
    expect(input).toContain("Finding 1");
  });

  it("is omitted from the triager when there is no scope", () => {
    expect(buildTriageInput({ verdict, diffDescription: "a branch" })).not.toContain(
      "# Files under review",
    );
  });

  it("reaches the fixer", () => {
    const input = buildFixerInput({
      taskHeader: scopedTaskHeader,
      diffBlock: "# Branch diff (x)",
      currentVerdict: verdict,
      priorFixProposal: "",
      round: 0,
    });
    expect(input).toContain(scopeBlock);
  });

  it("reaches the re-review pass", () => {
    const input = buildRereviewInput({
      taskHeader: scopedTaskHeader,
      diffDescription: "a branch",
      diffBody: "body",
      omittedFiles: 0,
      priorVerdict: verdict,
      fixProposal: "proposal",
    });
    expect(input).toContain(scopeBlock);
  });
});
