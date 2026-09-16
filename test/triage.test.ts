import { describe, it, expect } from "vitest";
import { buildTriager } from "../src/agents.js";
import { selectConfirmedFindings } from "../src/triage.js";
import { TriageSchema, type Issue, type Triage, type Verdict } from "../src/schemas.js";
import { FakeChatClient } from "./helpers/FakeChatClient.js";

const issue = (where: string, why: string): Issue => ({
  severity: "high",
  where,
  why,
  suggestion: "change it",
});

describe("TriageSchema", () => {
  it("accepts a well-formed triage", () => {
    const parsed = TriageSchema.parse({
      entries: [{ id: 1, status: "rejected", evidence: "contents?: Uint8Array is declared" }],
    });
    expect(parsed.entries[0]!.status).toBe("rejected");
  });

  it("rejects an entry with no status", () => {
    expect(() => TriageSchema.parse({ entries: [{ id: 1, evidence: "x" }] })).toThrow();
  });

  it("rejects an invented status", () => {
    expect(() =>
      TriageSchema.parse({ entries: [{ id: 1, status: "probably", evidence: "x" }] }),
    ).toThrow();
  });

  it("requires evidence even for a rejection", () => {
    expect(() =>
      TriageSchema.parse({ entries: [{ id: 1, status: "rejected", evidence: "" }] }),
    ).toThrow();
  });
});

describe("buildTriager", () => {
  it("returns the schema-validated triage", async () => {
    const client = new FakeChatClient().enqueue({
      entries: [
        { id: 1, status: "confirmed", evidence: "queue is never awaited" },
        { id: 2, status: "rejected", evidence: "contents is a documented option" },
      ],
    });
    const triage = await buildTriager(client).triage("findings");

    expect(triage.entries).toHaveLength(2);
    expect(triage.entries.map((e) => e.status)).toEqual(["confirmed", "rejected"]);
  });

  it("sends a system prompt that legitimises rejection", async () => {
    const client = new FakeChatClient().enqueue({ entries: [] });
    await buildTriager(client).triage("findings");

    const system = client.calls[0]!.find((m) => m.role === "system")!.content;
    expect(system).toMatch(/rejecting a finding is exactly as correct/i);
    expect(system).toMatch(/uncertain/i);
  });
});

describe("selectConfirmedFindings", () => {
  const verdict: Verdict = {
    verdict: "revise",
    issues: [
      issue("src/transcript.ts", "writes are never flushed"),
      issue("src/extension.ts", "createFile does not accept contents"),
    ],
  };
  const triage = (entries: Triage["entries"]): Triage => ({ entries });

  it("passes only confirmed findings to the fixer", () => {
    const { confirmed } = selectConfirmedFindings(
      verdict,
      triage([
        { id: 1, status: "confirmed", evidence: "queue is not awaited" },
        { id: 2, status: "rejected", evidence: "contents is declared in the typings" },
      ]),
    );
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.why).toContain("flushed");
  });

  it("excludes uncertain findings — a guess must not become an edit", () => {
    const { confirmed } = selectConfirmedFindings(
      verdict,
      triage([
        { id: 1, status: "uncertain", evidence: "source not provided" },
        { id: 2, status: "uncertain", evidence: "source not provided" },
      ]),
    );
    expect(confirmed).toHaveLength(0);
  });

  it("treats an unjudged finding as uncertain, not confirmed", () => {
    const { confirmed, statuses } = selectConfirmedFindings(
      verdict,
      triage([{ id: 1, status: "confirmed", evidence: "queue is not awaited" }]),
    );
    expect(confirmed).toHaveLength(1);
    expect(statuses[1]!.status).toBe("uncertain");
    expect(statuses[1]!.evidence).toMatch(/no triage entry/i);
  });

  it("reports a status for every finding, in verdict order", () => {
    const { statuses } = selectConfirmedFindings(verdict, triage([]));
    expect(statuses.map((s) => s.issue.where)).toEqual(["src/transcript.ts", "src/extension.ts"]);
  });
});
