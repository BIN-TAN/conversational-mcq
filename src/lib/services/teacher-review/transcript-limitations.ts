/**
 * Plain-language notes for the limitations a readable transcript reports. The codes stay in the
 * projection (and in exports) for analysis; instructors read these sentences instead.
 * No database access, so the session page can use it too.
 */
export const TRANSCRIPT_LIMITATION_NOTES: Record<string, string> = {
  internal_turns_excluded_available_in_assessment_log:
    "Some internal system steps are left out of this transcript. They are in the assessment log.",
  legacy_visibility_unspecified_not_proof_of_exposure:
    "Some messages were saved before the system recorded whether a message was shown to the student, so they do not show that the student saw them.",
  empty_text_turns_hidden: "Messages without any text are not shown."
};

export function transcriptLimitationNote(code: string) {
  return TRANSCRIPT_LIMITATION_NOTES[code] ?? code.replaceAll("_", " ");
}
