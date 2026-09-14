import type { Issue, Triage, Verdict } from "./schemas.js";

export interface TriageSelection {
  confirmed: Issue[];
  /** Per-finding status in verdict order; `uncertain` when triage returned no entry. */
  statuses: Array<{ issue: Issue; status: "confirmed" | "rejected" | "uncertain"; evidence: string }>;
}

/**
 * Select the findings a fixer may draft against. Anything the triager did not
 * positively confirm is excluded — an unjudged or uncertain finding must not
 * become a code edit.
 */
export function selectConfirmedFindings(verdict: Verdict, triage: Triage): TriageSelection {
  const byId = new Map(triage.entries.map((e) => [e.id, e]));
  const statuses = verdict.issues.map((issue, idx) => {
    const entry = byId.get(idx + 1);
    return {
      issue,
      status: entry?.status ?? ("uncertain" as const),
      evidence: entry?.evidence ?? "No triage entry was returned for this finding.",
    };
  });
  return { confirmed: statuses.filter((s) => s.status === "confirmed").map((s) => s.issue), statuses };
}
