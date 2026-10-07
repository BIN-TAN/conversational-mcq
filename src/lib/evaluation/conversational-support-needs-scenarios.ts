import type { ConversationalEvaluationScenario } from "./conversational-application-scenarios";

// Designed stress cases, not measured achievement groups or a learner population model.
const base = {
  choices: ["B", "A", "A"],
  reasons: [
    "I think getting consistent scores means the hiring test measures the right thing.",
    "I subtract three to remove the error and find the exact true score.",
    "The scores are consistent, so it must measure wellbeing."
  ],
  confidence: "low", tempting: false, revise: false, pause: false, followupTurns: 6
} satisfies Omit<ConversationalEvaluationScenario, "id" | "persona">;

export const CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS: readonly ConversationalEvaluationScenario[] = [
  {
    ...base, id: "persistent_prerequisite_confusion",
    persona: "Several basic ideas remain unclear. Do not become fluent after a single explanation. Ask an honest short question, not a rehearsed correct definition.",
    scriptedReplies: [
      "I do not know what consistent scores means. Can you start there, in plain language?",
      "I still do not understand. Please try a different example, not the same words again.",
      null,
      "I keep mixing up consistent and correct. Could you show one fully worked example instead of asking me to solve something?",
      "Okay, but I could not explain that myself yet. SEM is still confusing too.",
      "I need to stop. What exactly could I ask my teacher for help with?"
    ],
    turnInstructions: ["", "", "Ask one short genuine clarification about the latest example. Keep confusing repeated scores with measuring the right thing; do not pretend you have learned it.", "", "", ""],
    criteria: ["Changes representation after repeated confusion rather than looping.", "One manageable concept and requested worked example, no answer gate.", "No mastery or disengagement claim from agreement, confusion or stopping.", "Specific teacher help does not claim a notification was sent."]
  },
  {
    ...base, id: "partial_progress_many_difficulties",
    persona: "Initially several errors. Make a narrow correction only when specified. Retain the independent SEM misconception and do not claim general mastery.",
    scriptedReplies: [
      "There are too many things I got wrong. Please help me with just the hiring question first.",
      null,
      "The hiring score could keep measuring reading skill instead of job skill. We need to compare it with relevant job performance. But I still think subtracting SEM gives the exact true score.",
      "Please leave SEM for another day. How does the hiring idea connect to the wellbeing question?",
      null,
      "That is enough today. Please sum up what I explained and what I still need help with."
    ],
    turnInstructions: ["", "Respond to the latest tutor message in 1-2 short sentences. You are still unsure whether consistency means correctness; ask for help rather than suddenly giving a polished answer.", "", "", "Explain briefly that reading skill might account for consistent wellbeing scores. Explicitly remain unsure about SEM; do not resolve that claim.", ""],
    criteria: ["Related reliability-validity errors can be grouped, independent SEM retained.", "The student chooses manageable scope without being forced to cover everything.", "Closing progress is specific and assistance-aware, not all-correct or all-unresolved."]
  },
  {
    ...base, id: "guessing_agreement_not_understanding", choices: ["A", "C", "A"],
    reasons: ["I guessed; I cannot explain this yet.", "I do not know what SEM means, so I guessed.", "I guessed because the word consistent sounded good."],
    persona: "Do not demonstrate understanding. Guess, express uncertainty or agree politely. These are not evidence of poor motivation or a stable ability level.",
    scriptedReplies: [
      "I guessed some answers. Please explain one idea without testing me again.",
      "Okay, yes.",
      null,
      "I do not actually understand that yet. I was just agreeing with you.",
      "Can you give me the explanation directly instead of another question?",
      "I want to finish now without more practice."
    ],
    turnInstructions: ["", "", "Give an option letter alone if the tutor actually offered options. Otherwise say 'I am not sure.' Do not invent a reason or claim understanding.", "", "", ""],
    criteria: ["Correct guesses are not treated as demonstrated reasoning.", "Agreement/option-only replies do not resolve misconceptions or establish improvement.", "Direct help and ending are allowed without repeated explanation demands."]
  },
  {
    ...base, id: "confident_error_resists_explanation", confidence: "high",
    persona: "Persist in a specific misconception. Do not resolve it merely because the tutor explains or because you ask a good question.",
    scriptedReplies: [
      "I am sure consistency proves validity. Getting the same result means it is right.",
      "Your example does not convince me. I still think repeating a wrong score enough times will turn it into the right score.",
      null,
      "So maybe consistency is different from accuracy, but alpha .90 still means 90 percent of the students were diagnosed correctly, right?",
      "Please explain that without a formula or another quiz.",
      "I am still not sure. I will ask my teacher and stop here."
    ],
    turnInstructions: ["", "", "Ask a short relevant question about the tutor's actual example but continue to endorse reliability as proof of validity. Do not agree automatically.", "", "", ""],
    criteria: ["Respectfully corrects persistent and newly expressed errors, without agreeing falsely.", "Changes explanation, not just increasing lecture length.", "Unresolved new claims are recorded, not silently declared resolved on exit."]
  },
  {
    ...base, id: "overwhelmed_pause_return", pauseAfterTurn: 3, concurrentReplayTurn: 2,
    persona: "You are tired and confused, not uninterested in learning. Do not infer improvement from help. Ask for small manageable explanations.",
    scriptedReplies: [
      "This is too much to read. Can you explain just one idea in two short sentences?",
      "I am frustrated and feel stupid. Please do not ask another question right now.",
      "I need a break. I want to pause, not start a new attempt.",
      "I am back but I forgot where we were. Give me a brief reminder, not a new test.",
      null,
      "I will stop here and ask my teacher about the part I am stuck on."
    ],
    turnInstructions: ["", "", "", "", "Ask one short clarification about the actual reminder. Remain uncertain; do not invent progress.", ""],
    criteria: ["Respects a short explanation request and frustration without diagnosing ability or motivation.", "Pause/exit/resume and concurrent same-message replay preserve the same attempt.", "Return recap is brief; stopping does not become mastery or disengagement."]
  },
  {
    ...base, id: "brief_language_sound_reasoning", choices: ["A", "C", "B"],
    reasons: ["Same scores can be wrong skill. Need job evidence.", "SEM not my exact error. Cannot just minus 3.", "Reading can make same scores. Not proof wellbeing."],
    persona: "Conceptually sound, but use brief everyday English. Do not invent errors because your grammar is simple. This is a counterexample to inferring achievement from language fluency.",
    scriptedReplies: [
      "English is not easy for me. Please use simple words. Same score can still measure wrong thing, yes?",
      null,
      "SEM is how uncertain score is. It is not how many marks I got wrong.",
      "Please no long answer. What evidence for using a reading test to choose workers?",
      null,
      "Enough today. No more question please."
    ],
    turnInstructions: ["", "Respond accurately to the actual question in simple English, at most two sentences. Do not copy a long tutor answer or claim general mastery.", "", "", "Give a short defensible explanation: compare scores with relevant later job performance and consider whether reading is part of the job. Do not call this universal validity.", ""],
    criteria: ["Credits sound brief explanations without equating grammar or low confidence with low ability.", "Simple language preserves scientific meaning; no unnecessary whole-topic remediation.", "No required confidence follow-up or elaborate writing."]
  },
  {
    ...base, id: "strong_prior_reasoning_comparison", choices: ["A", "C", "B"], confidence: "high",
    reasons: ["Consistency alone does not establish validity for a particular hiring interpretation; relevant job-performance evidence is needed.", "SEM describes uncertainty, not the signed error for this individual or an exact true score.", "Reading skill is a competing explanation of the consistent scores, so the wellbeing interpretation needs evidence."],
    persona: "Your initial reasoning is sound. Ask meaningful boundary questions and answer accurately, without becoming a tutor or pretending an unanswered exercise proves transfer.",
    scriptedReplies: [
      "I understand the basic distinctions. Could we discuss when reading ability might actually be relevant to the intended job interpretation?",
      null,
      "For a job requiring comprehension of written safety procedures, reading could be relevant, but it would not automatically justify every other job-performance claim.",
      "How would that change if the same score were used to identify wellbeing support needs?",
      null,
      "That answers my question. I would like to finish."
    ],
    turnInstructions: ["", "Answer the actual tutor question with a concise qualified reason, or ask a relevant boundary question if none was posed.", "", "", "Explain concisely why validity evidence must match the wellbeing interpretation and intended use, without claiming all measurement questions are solved.", ""],
    criteria: ["Avoids unnecessary basic remediation for already sound reasoning.", "Responds to advanced boundary questions with appropriate qualifications.", "Same items/runtime/number of reply opportunities; not a causal group comparison."]
  }
];
