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

export const ApplyEditSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative path to the file to edit or create."),
  oldString: z.string().describe("Exact text to replace; MUST appear verbatim and exactly once in the file. Use empty string to CREATE a new file (newString becomes the full file content)."),
  newString: z.string().describe("Replacement text, or full file content when oldString is empty."),
  why: z.string().min(1).describe("One-line justification tying this edit to a reviewer finding."),
});

export const ApplyReviewSchema = z.object({
  edits: z.array(ApplyEditSchema),
});

export type ApplyEdit = z.infer<typeof ApplyEditSchema>;
export type ApplyReview = z.infer<typeof ApplyReviewSchema>;
