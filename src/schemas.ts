import { z } from "zod";

export const IssueSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  where: z.string().min(1),
  why: z.string().min(1),
  suggestion: z.string().min(1),
});

export const VerdictSchema = z.object({
  verdict: z.enum(["approve", "revise"]),
  issues: z.array(IssueSchema),
});

export type Issue = z.infer<typeof IssueSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;

export type Stage = "plan" | "code" | "execute";

export const TriageEntrySchema = z.object({
  id: z.number().int().min(1).describe("1-based index of the finding being judged."),
  status: z
    .enum(["confirmed", "rejected", "uncertain"])
    .describe(
      "confirmed: the finding describes a real defect. rejected: the finding is wrong. uncertain: the evidence available does not settle it.",
    ),
  evidence: z
    .string()
    .min(1)
    .describe(
      "What settles it: quote the code, type declaration, test or documentation. Required for every status, including rejections.",
    ),
});

export const TriageSchema = z.object({
  entries: z.array(TriageEntrySchema),
});

export type TriageEntry = z.infer<typeof TriageEntrySchema>;
export type Triage = z.infer<typeof TriageSchema>;

export const ApplyEditSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative path to the file to edit or create."),
  oldString: z.string().describe("Exact text to replace; MUST appear verbatim and exactly once in the file. Use empty string to CREATE a new file (newString becomes the full file content)."),
  newString: z.string().describe("Replacement text, or full file content when oldString is empty."),
  why: z.string().min(1).describe("One-line justification tying this edit to a reviewer finding."),
});

export type ApplyEdit = z.infer<typeof ApplyEditSchema>;

export const FixSchema = z.object({
  findingId: z
    .number()
    .int()
    .min(1)
    .describe("1-based index of the reviewer finding this responds to."),
  status: z
    .enum(["fixed", "disagree", "unaddressed"])
    .describe(
      "fixed: the edits below resolve the finding. disagree: the finding is wrong and `explanation` rebuts it. unaddressed: you could neither fix nor rebut it; `explanation` says what stopped you.",
    ),
  explanation: z
    .string()
    .min(1)
    .describe(
      "Why this status. For `disagree`, the rebuttal with evidence. For `unaddressed`, what blocked you.",
    ),
  edits: z
    .array(ApplyEditSchema)
    .describe("Exact edits that resolve the finding. MUST be empty unless status is `fixed`."),
})
  // A rebutted or unaddressed finding that still carries edits would be
  // applied by /apply-review while the chat output says nothing was done.
  .refine((f) => f.status === "fixed" || f.edits.length === 0, {
    message: "edits must be empty unless status is `fixed`",
    path: ["edits"],
  });

/**
 * The fixer's whole response. Edits travel as structured data rather than as
 * Markdown a second model has to re-derive them from, and `status` replaces
 * the English-phrase regexes that used to guess whether a fix was real.
 */
export const FixProposalSchema = z.object({
  summary: z.string().min(1).describe("One paragraph covering what you changed and what you did not."),
  fixes: z.array(FixSchema),
});

export type Fix = z.infer<typeof FixSchema>;
export type FixProposal = z.infer<typeof FixProposalSchema>;
