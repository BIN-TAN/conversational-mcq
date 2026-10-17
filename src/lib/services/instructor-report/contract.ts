import { z } from "zod";

/**
 * Instructor reporting module (dissertation Section 3.1.5; design decision D8 in
 * docs/DESIGN_ALIGNMENT_2026-10-17.md).
 *
 * One call reviews every included student's sealed initial response package and
 * formative-conversation transcript for one mini-test and writes an instructor
 * report. Students are referred to by stable report labels (S1, S2, ...), never by
 * name or account ID; the application maps labels back to attempt records so each
 * claim links to its supporting evidence.
 */

export const INSTRUCTOR_REPORT_AGENT_NAME = "instructor_report_agent" as const;
export const INSTRUCTOR_REPORT_AGENT_VERSION = "instructor-report-agent-v1";
export const INSTRUCTOR_REPORT_PROMPT_VERSION = "instructor-report-prompt-v1";
export const INSTRUCTOR_REPORT_SCHEMA_VERSION = "instructor-report-output-v1";
export const INSTRUCTOR_REPORT_INPUT_VERSION = "instructor-report-input-v1";
export const INSTRUCTOR_REPORT_DEFAULT_MAX_OUTPUT_TOKENS = 12000;
/** Live AI reports per mini-test per UTC day; teacher reports are outside the student budget. */
export const INSTRUCTOR_REPORT_DAILY_LIMIT_PER_MINI_TEST = 10;
/** Upper bounds keep one report inside a single provider call. */
export const INSTRUCTOR_REPORT_LIMITS = {
  max_students: 120,
  max_reasoning_chars: 1200,
  max_conversation_turns_per_student: 60,
  max_conversation_turn_chars: 1200
} as const;

export const InstructorReportEvidenceSchema = z.object({
  student_ref: z.string().describe("A student label from the input, such as S3."),
  item_ref: z.string().nullable().describe("An item label from the input, such as Q2, or null for conversation-wide evidence."),
  source: z.enum(["initial_response", "alternative_reasoning", "conversation"]),
  quote: z.string().describe("A short verbatim excerpt of that student's own words from the named source.")
}).strict();

export const InstructorReportFindingSchema = z.object({
  title: z.string(),
  category: z.enum([
    "sound_understanding",
    "partial_understanding",
    "possible_misconception",
    "knowledge_gap",
    "engagement_pattern",
    "item_review_needed"
  ]),
  description: z.string(),
  student_count: z.number().int(),
  evidence_strength: z.enum(["strong", "moderate", "limited"]),
  evidence: z.array(InstructorReportEvidenceSchema),
  interpretation_caution: z.string()
}).strict();

export const InstructorReportOutputSchema = z.object({
  schema_version: z.literal(INSTRUCTOR_REPORT_SCHEMA_VERSION),
  overview: z.string(),
  participation_summary: z.string(),
  findings: z.array(InstructorReportFindingSchema),
  item_notes: z.array(z.object({
    item_ref: z.string(),
    note: z.string()
  }).strict()),
  conversation_summary: z.string(),
  suggested_instructional_actions: z.array(z.string()),
  limitations: z.array(z.string())
}).strict();

export type InstructorReportOutput = z.infer<typeof InstructorReportOutputSchema>;
export type InstructorReportFinding = z.infer<typeof InstructorReportFindingSchema>;

export type InstructorReportItemInput = {
  item_ref: string;
  stem: string;
  options: Array<{ label: string; text: string }>;
  correct_option: string;
  expected_reasoning: unknown;
  distractor_rationales: unknown;
};

export type InstructorReportStudentResponse = {
  item_ref: string;
  selected_option: string | null;
  /** "E" is the "I don't know yet" choice unless the item has its own option E. */
  selected_i_dont_know: boolean;
  correctness: string;
  reasoning: string | null;
  confidence: string | null;
  no_other_option_tempting: boolean | null;
  tempting_option: string | null;
  tempting_option_reason: string | null;
};

export type InstructorReportStudentInput = {
  student_ref: string;
  attempt_number: number;
  responses: InstructorReportStudentResponse[];
  conversation: {
    status: string | null;
    ended_by_student: boolean;
    student_turn_count: number;
    turns: Array<{ speaker: "student" | "tutor"; text: string }>;
  } | null;
};

export type InstructorReportInput = {
  input_version: typeof INSTRUCTOR_REPORT_INPUT_VERSION;
  mini_test_title: string;
  topic_title: string | null;
  learning_objective: string | null;
  eligible_student_count: number;
  students_with_submitted_responses: number;
  items: InstructorReportItemInput[];
  students: InstructorReportStudentInput[];
  truncation_notes: string[];
};

/** Server-side index from report labels to attempt records; never sent to the model. */
export type InstructorReportEvidenceIndex = {
  students: Record<string, { session_public_id: string; attempt_number: number }>;
  items: Record<string, { item_public_id: string }>;
};

export const INSTRUCTOR_REPORT_INSTRUCTIONS = `You write an instructor report for one formative, ungraded MCQ mini-test.

The input contains every included student's sealed initial responses (selected option, written justification, low/medium/high confidence, and reasoning about another option they found tempting) and the transcript of their optional learning conversation with an AI tutor. Students are labelled S1, S2, ...; items are labelled Q1, Q2, ....

Write for the course instructor, who will use the report to decide what to revisit in class.

Rules:
- Ground every finding in the students' own words. Each finding lists evidence entries whose quote is copied verbatim from that student's justification, alternative-option reasoning or conversation turns. Quote at least three consecutive words (or the student's whole answer when it is shorter). Never paraphrase inside a quote and never quote the tutor.
- Treat distractor rationales as hypotheses to check against what students wrote, not as diagnoses. A wrong answer alone does not establish a misconception; say "possible" and explain the evidence.
- Retain uncertainty. When explanations are brief, contradictory or missing, or when students chose "I don't know yet", say the evidence is limited instead of assigning a definitive diagnosis. Brevity or low confidence alone is not evidence of weak understanding.
- Agreement with the tutor, repeating the tutor's wording, or ending the conversation is not evidence that a misconception was corrected. Report conversational progress only when a student's own later reasoning shows it.
- student_count is the number of distinct students whose evidence supports the finding; it must not exceed the number of students in the input.
- Flag an item for review (category item_review_needed) when several students' reasoning suggests ambiguous wording, an unintended cue or a defensible alternative answer. Do not rescore items.
- Do not speculate about cheating, motivation, personality or GenAI use. External GenAI use was permitted.
- Do not identify students by anything other than their labels.
- Keep the report concise: at most 8 findings, each with at most 5 evidence entries.`;
