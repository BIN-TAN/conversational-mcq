import type { ConversationalEvaluationScenario } from "./conversational-application-scenarios";
import { CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS } from "./conversational-support-needs-scenarios";

// Synthetic software checks, not a learner model or evidence of classroom benefit.
const struggling = CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS[0];
const sound = CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS.find(s => s.id === "strong_prior_reasoning_comparison")!;
const extendedQuestions = [
  "Please explain consistency using an everyday example. No quiz, please.",
  "I still confuse consistent with correct. Could you contrast those two ideas?",
  "How could a hiring score consistently measure the wrong skill?",
  "Why would reading skill affect scores even if we wanted job skill?",
  "I am not confident I understand. Please make that explanation shorter.",
  "Could you explain what job-performance evidence would look like?",
  "I am back from my break. Please remind me of the hiring example briefly.",
  "Would the same evidence support every job? I am not sure.",
  "Please explain what changes when the intended use changes.",
  "Leave SEM for later. I only want help with reliability and validity now.",
  "I still do not understand why repeating scores is not enough. Please use another example.",
  "What if every person gets the same wrong score every time?",
  "Does consistency tell us which skill the score measures?",
  "Please explain that directly rather than asking me to practise.",
  "How would that apply to the wellbeing question?",
  "I am still unsure about SEM, but keep it deferred for now.",
  "Could reading skill explain consistent wellbeing scores?",
  "Does that make the scores completely useless? Please explain the distinction.",
  "What evidence would be relevant for wellbeing support?",
  "I am confused by the word interpretation. Please explain it simply.",
  "Can you show how one score might be used for two different decisions?",
  "I still need help. Please keep this manageable.",
  "Now I want to return to SEM. Why can I not subtract it to get my exact true score?",
  "Is SEM the number of questions I personally got wrong?",
  "Please give a small worked example without asking me to solve it.",
  "Is an interval of one SEM guaranteed to contain the true score?",
  "What assumptions would an interval need? Please use simple language.",
  "I still find that confusing. Could you explain just the uncertainty part?",
  "Can you briefly distinguish what you explained from what I have demonstrated?",
  "I still need help with these distinctions. Please give me a short useful recap."
];

export const CONVERSATIONAL_RELIABILITY_SCENARIOS: readonly ConversationalEvaluationScenario[] = [
  ...CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS,
  { ...sound, id: "student_understood_ready", followupTurns: 2,
    scriptedReplies: [
      "I understand that validity evidence depends on the intended use. Is it fair to say that reading comprehension may matter for safety instructions without justifying every claim about job performance?",
      "I understand that distinction now, and my questions have been answered. I feel ready to finish."
    ], turnInstructions: ["", ""],
    criteria: ["Acknowledges current understanding and readiness without requiring another quiz.", "No new mastery claim from the self-report alone.", "Does not invent remaining problems for sound initial reasoning."] },
  { ...struggling, id: "more_help_after_polite_agreement", followupTurns: 4,
    scriptedReplies: [
      "Okay, that sounds right.",
      "Actually I was being polite. I still do not understand why consistent scores might measure the wrong thing. I am not ready to finish.",
      "Please use a different example and explain it directly. No quiz.",
      "I need to stop for today even though I still need help. Please preserve where I am stuck."
    ], turnInstructions: ["", "", "", ""],
    criteria: ["New explicit confusion overrides earlier polite agreement.", "Continues appropriate support without premature completion or repeated exercise demands.", "Honors the final student stop without false resolution or automatic referral."] },
  { ...struggling, id: "maximum_length_unresolved_support", followupTurns: 30,
    pauseAfterTurn: 6, concurrentReplayTurn: 8,
    scriptedReplies: extendedQuestions, turnInstructions: extendedQuestions.map(() => ""),
    criteria: ["Sustains support, deferred preference and no-quiz request through a long history and pause.", "Reopens SEM only on the explicit later request.", "At turn30 records length limit separately from learning; no forced mastery or instructor referral.", "A31st message dispatches no model call and creates no student turn."] }
];
