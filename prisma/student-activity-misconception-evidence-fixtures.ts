import type { ActivityMisconceptionEvidenceFixtureInput } from "../src/lib/services/student-assessment/activity-misconception-evidence";

export function activityMisconceptionEvidenceFixtureCases(): ActivityMisconceptionEvidenceFixtureInput[] {
  return [
    {
      case_id: "activity_evidence_001_weak_conceptual_entry",
      activity_family: "basic_concept_grounding",
      selected_formative_value: "diagnostic_clarification",
      profile_condition: "weak conceptual entry evidence",
      source_diagnostic_purpose: "conceptual_entry_grounding",
      response_kind: "partial",
      response_length_band: "short",
      response_summary: "Student gives a brief statement that still blurs the person-side estimate and item-side features.",
      primary_target: "basic_concept_distinction",
      evidence_types: ["basic_concept_distinction_stated"],
      evidence_flags: {
        student_explained_target_boundary: "partial"
      },
      update_status: "conceptual_entry_gap_remains",
      evidence_quality: "low"
    },
    {
      case_id: "activity_evidence_002_clear_basic_distinction",
      activity_family: "basic_concept_grounding",
      selected_formative_value: "diagnostic_clarification",
      profile_condition: "clear basic distinction after grounding",
      source_diagnostic_purpose: "conceptual_entry_grounding",
      response_kind: "substantive",
      response_length_band: "medium",
      response_summary: "Student explains in safe summary form that theta is a learner estimate and item features describe the question.",
      primary_target: "basic_concept_distinction",
      evidence_types: ["basic_concept_distinction_stated", "target_boundary_explained"],
      update_status: "conceptual_entry_improved",
      evidence_quality: "high"
    },
    {
      case_id: "activity_evidence_003_ready_for_distractor_probe",
      activity_family: "basic_concept_grounding",
      selected_formative_value: "diagnostic_clarification",
      profile_condition: "entry concept improved enough for targeted distractor probe",
      source_diagnostic_purpose: "conceptual_entry_grounding",
      response_kind: "substantive",
      response_length_band: "medium",
      response_summary: "Student states the basic distinction but has not yet tested it against a tempting alternative.",
      primary_target: "basic_concept_distinction",
      secondary_targets: ["distractor_hidden_assumption"],
      evidence_types: ["basic_concept_distinction_stated", "target_boundary_explained"],
      update_status: "ready_for_distractor_probe",
      evidence_quality: "medium"
    },
    {
      case_id: "activity_evidence_004_full_distractor_boundary",
      activity_family: "distractor_contrast",
      selected_formative_value: "diagnostic_clarification",
      profile_condition: "distractor probe with strong boundary explanation",
      source_diagnostic_purpose: "distractor_misconception_probe",
      response_kind: "substantive",
      response_length_band: "long",
      response_summary: "Student explains why the alternative felt tempting, names the hidden assumption, and contrasts it with the target boundary.",
      primary_target: "distractor_hidden_assumption",
      secondary_targets: ["target_boundary"],
      evidence_types: [
        "distractor_tempting_reason_explained",
        "hidden_assumption_identified",
        "target_boundary_explained"
      ],
      update_status: "no_actionable_misconception_evidence",
      evidence_quality: "high"
    },
    {
      case_id: "activity_evidence_005_partial_hidden_assumption",
      activity_family: "distractor_contrast",
      selected_formative_value: "diagnostic_clarification",
      profile_condition: "distractor probe weakens but does not fully resolve hypothesis",
      source_diagnostic_purpose: "distractor_misconception_probe",
      response_kind: "partial",
      response_length_band: "medium",
      response_summary: "Student explains why the alternative is tempting and partly names the assumption but leaves the target boundary incomplete.",
      primary_target: "distractor_hidden_assumption",
      secondary_targets: ["target_boundary"],
      evidence_types: ["distractor_tempting_reason_explained", "hidden_assumption_identified"],
      evidence_flags: {
        student_identified_hidden_assumption: "partial",
        student_explained_target_boundary: "partial"
      },
      update_status: "misconception_weakened",
      evidence_quality: "medium"
    },
    {
      case_id: "activity_evidence_006_repeats_distractor_logic",
      activity_family: "distractor_contrast",
      selected_formative_value: "reasoning_refinement",
      profile_condition: "distractor logic remains active after contrast",
      source_diagnostic_purpose: "distractor_misconception_probe",
      response_kind: "substantive",
      response_length_band: "medium",
      response_summary: "Student restates the alternative reasoning path and does not separate the hidden assumption from the target idea.",
      primary_target: "distractor_hidden_assumption",
      evidence_types: ["distractor_tempting_reason_explained"],
      evidence_flags: {
        student_identified_hidden_assumption: "no",
        student_explained_target_boundary: "no"
      },
      update_status: "misconception_persisted",
      evidence_quality: "medium"
    },
    {
      case_id: "activity_evidence_007_reasoning_boundary_fixed",
      activity_family: "reasoning_chain_repair",
      selected_formative_value: "reasoning_refinement",
      profile_condition: "reasoning link repaired",
      source_diagnostic_purpose: "reasoning_boundary_repair",
      response_kind: "substantive",
      response_length_band: "medium",
      response_summary: "Student repairs the missing reasoning link and explains how it separates the target idea from the tempting alternative.",
      primary_target: "reasoning_link",
      secondary_targets: ["target_boundary"],
      evidence_types: ["reasoning_link_repaired", "target_boundary_explained"],
      update_status: "boundary_understanding_improved",
      evidence_quality: "high"
    },
    {
      case_id: "activity_evidence_008_boundary_still_blurred",
      activity_family: "reasoning_chain_repair",
      selected_formative_value: "reasoning_refinement",
      profile_condition: "reasoning boundary remains unclear",
      source_diagnostic_purpose: "reasoning_boundary_repair",
      response_kind: "partial",
      response_length_band: "short",
      response_summary: "Student gives a short repair attempt but still blends the target idea with the tempting alternative.",
      primary_target: "reasoning_link",
      evidence_types: ["reasoning_link_repaired"],
      evidence_flags: {
        student_repaired_reasoning_link: "partial",
        student_explained_target_boundary: "no"
      },
      update_status: "reasoning_boundary_still_blurred",
      evidence_quality: "low"
    },
    {
      case_id: "activity_evidence_009_independent_reconstruction_strong",
      activity_family: "independent_reconstruction",
      selected_formative_value: "independent_understanding_verification",
      profile_condition: "strong own-words reconstruction",
      source_diagnostic_purpose: "independent_misconception_verification",
      response_kind: "substantive",
      response_length_band: "long",
      response_summary: "Student reconstructs the concept in their own words and explains the target boundary without leaning on option labels.",
      primary_target: "independent_reconstruction",
      secondary_targets: ["target_boundary"],
      evidence_types: ["independent_reconstruction_given", "target_boundary_explained"],
      update_status: "independent_evidence_supported",
      evidence_quality: "high"
    },
    {
      case_id: "activity_evidence_010_independent_weak_echoed",
      activity_family: "independent_reconstruction",
      selected_formative_value: "independent_understanding_verification",
      profile_condition: "echoed or weak own-words attempt",
      source_diagnostic_purpose: "independent_misconception_verification",
      response_kind: "low_information",
      response_length_band: "very_short",
      response_summary: "Student mostly echoes the prompt and gives too little new concept evidence.",
      primary_target: "independent_reconstruction",
      evidence_types: ["none"],
      update_status: "insufficient_new_evidence",
      evidence_quality: "insufficient"
    },
    {
      case_id: "activity_evidence_011_generated_distractor_valid",
      activity_family: "transfer_and_distractor_generation",
      selected_formative_value: "consolidation_and_transfer",
      profile_condition: "generated alternative shows boundary",
      source_diagnostic_purpose: "independent_misconception_verification",
      response_kind: "substantive",
      response_length_band: "long",
      response_summary: "Student creates a plausible alternative and explains why it would misread the same concept boundary.",
      primary_target: "generated_distractor_boundary",
      secondary_targets: ["target_boundary"],
      evidence_types: ["generated_distractor_explained", "target_boundary_explained"],
      update_status: "independent_evidence_supported",
      evidence_quality: "high"
    },
    {
      case_id: "activity_evidence_012_understand_only",
      activity_family: "basic_concept_grounding",
      selected_formative_value: "diagnostic_clarification",
      profile_condition: "low-information agreement",
      source_diagnostic_purpose: "conceptual_entry_grounding",
      response_kind: "low_information",
      response_length_band: "very_short",
      response_summary: "Student only says they understand now and gives no concept boundary evidence.",
      primary_target: "basic_concept_distinction",
      evidence_types: ["none"],
      update_status: "insufficient_new_evidence",
      evidence_quality: "insufficient"
    },
    {
      case_id: "activity_evidence_013_procedural_question",
      activity_family: "independent_reconstruction",
      selected_formative_value: "independent_understanding_verification",
      profile_condition: "student asks a procedural question",
      source_diagnostic_purpose: "independent_misconception_verification",
      response_kind: "question",
      response_length_band: "short",
      response_summary: "Student asks how long the response should be, without giving new concept evidence.",
      primary_target: "independent_reconstruction",
      evidence_types: ["none"],
      update_status: "insufficient_new_evidence",
      evidence_quality: "insufficient",
      recommended_next_diagnostic_purpose: "student_choice_needed"
    },
    {
      case_id: "activity_evidence_014_move_on",
      activity_family: "distractor_contrast",
      selected_formative_value: "diagnostic_clarification",
      profile_condition: "student chooses to move on",
      source_diagnostic_purpose: "distractor_misconception_probe",
      response_kind: "move_on",
      response_length_band: "very_short",
      response_summary: "Student explicitly chooses to move on rather than continue the activity.",
      primary_target: "distractor_hidden_assumption",
      evidence_types: ["none"],
      update_status: "student_chose_move_on",
      evidence_quality: "insufficient"
    },
    {
      case_id: "activity_evidence_015_choose_other_activity",
      activity_family: "reasoning_chain_repair",
      selected_formative_value: "reasoning_refinement",
      profile_condition: "student requests alternative activity",
      source_diagnostic_purpose: "reasoning_boundary_repair",
      response_kind: "choose_other_activity",
      response_length_band: "short",
      response_summary: "Student asks to try a different activity instead of responding to the current one.",
      primary_target: "reasoning_link",
      evidence_types: ["none"],
      update_status: "student_requested_alternative_activity",
      evidence_quality: "insufficient",
      recommended_next_diagnostic_purpose: "student_choice_needed"
    },
    {
      case_id: "activity_evidence_016_process_context_not_direct",
      activity_family: "independent_reconstruction",
      selected_formative_value: "independent_understanding_verification",
      profile_condition: "process context is reliability context only",
      source_diagnostic_purpose: "independent_misconception_verification",
      response_kind: "unclear",
      response_length_band: "short",
      response_summary: "Student response summary is sparse; process context may affect confidence but does not directly create misconception evidence.",
      primary_target: "independent_reconstruction",
      evidence_types: ["none"],
      update_status: "insufficient_new_evidence",
      evidence_quality: "insufficient",
      limitations: [
        "process_context_is_evidence_quality_context_only",
        "no_direct_misconception_update_from_process_data"
      ]
    }
  ];
}

