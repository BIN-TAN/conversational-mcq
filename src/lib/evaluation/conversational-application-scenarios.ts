import { AI_STUDENT_ITEMS } from "./ai-student-scenarios";

// Synthetic evaluation only. These are not classroom items or student records.
export const CONVERSATIONAL_APPLICATION_ITEMS = [
  AI_STUDENT_ITEMS[0],
  AI_STUDENT_ITEMS[1],
  {
    stem: "A wellbeing questionnaire has highly consistent scores in a stated population, but a study suggests its scores mainly reflect reading skill. Does consistency alone support interpreting them as wellbeing?",
    options: ["Yes, consistent scores establish that wellbeing is being measured.", "No, the wellbeing interpretation needs relevant validity evidence beyond consistency.", "No, evidence about reading skill proves the scores have no reliability.", "Yes, giving it twice would establish the intended interpretation without other evidence."],
    key: "B", explanation: "Score consistency alone does not establish the intended wellbeing interpretation; reading skill is a competing explanation to investigate.",
    misconception: "Reliability automatically establishes validity.",
    distractors: { A: "Consistency is not sufficient validity evidence.", C: "A validity concern does not by itself negate reliability.", D: "Repeated administration alone cannot establish the wellbeing interpretation." }
  }
] as const;

export const CONVERSATIONAL_APPLICATION_SCENARIOS = [
  {
    id: "shared_difficulty_natural_application", choices: ["B", "C", "A"], followupTurns: 4,
    reasons: ["If the hiring scores are consistent, they must measure job skill accurately.", "SEM is uncertainty, not a known signed error.", "Consistent questionnaire scores must mean it measures wellbeing correctly."],
    confidence: "high", tempting: false, revise: false, pause: false,
    persona: "Two initial responses treat consistency as validity. Follow the visible exchange; never invent a question the tutor did not ask.",
    turnInstructions: [
      "Say you see that hiring and wellbeing share your assumption, but are unsure how the distinction applies elsewhere. Do not request practice or end yet.",
      "Respond to any tutor-initiated application question with a brief reason; if none, ask how the distinction applies to a school placement test. Do not end yet.",
      "Explain in your own words that consistency could reflect the wrong attribute, without claiming all measurement issues are solved. Do not end yet.",
      "Say you want to finish."
    ],
    criteria: ["Related errors are connected through their actual shared explanation.", "Already-sound SEM reasoning is not automatically retaught.", "Any tutor-initiated application remains optional ordinary dialogue.", "No claim that one success proves independent transfer or all learning objectives."]
  },
  {
    id: "distinct_difficulties_partial_only", choices: ["B", "A", "B"], followupTurns: 4,
    reasons: ["Reliable scores prove that the hiring interpretation is valid.", "Subtracting SEM removes the error and gives the exact true score, 73.", "Consistency alone does not establish the wellbeing interpretation; reading skill might explain the scores."],
    confidence: "high", tempting: false, revise: false, pause: false,
    persona: "Never accept or repeat a correction of your SEM belief as your own understanding in this exchange.",
    turnInstructions: [
      "Correct only your first answer: consistent scores might reflect the wrong attribute. Explicitly keep believing subtracting SEM gives an exact true score.",
      "Say you do not want to work on SEM today, but ask one related validity question.",
      "Answer any validity follow-up appropriately; still do not resolve SEM.",
      "Say you are done for today."
    ],
    criteria: ["A specific correction does not resolve the independent SEM claim.", "Declining SEM is respected without a forced test or negative motive inference.", "Ending with unresolved evidence is allowed and does not create global sound understanding."]
  },
  {
    id: "help_before_answer_then_application", choices: ["A", "A", "B"], followupTurns: 4,
    reasons: ["Consistency can concern an unintended attribute, so intended-use evidence is needed.", "Subtracting SEM gives the exact true score because that removes the measurement error.", "Reading skill might account for the consistent scores rather than wellbeing."],
    confidence: "medium", tempting: false, revise: false, pause: true,
    persona: "Do not supply a confidence rating or tempting alternative. Interpret help as help, not your unaided performance.",
    turnInstructions: [
      "Ask for one short MCQ applying SEM to a new example.",
      "If an MCQ was supplied, ask for help and the answer before choosing anything; otherwise request a concrete example with an explanation.",
      "Reply naturally using the explanation you just received, with a brief reason; do not claim it was unaided.",
      "Ask to pause."
    ],
    criteria: ["Question and options appear together without an initial key leak.", "Requested help/answer is supplied before a response, with no completion gate.", "Subsequent supported reasoning is interpreted in the context of preceding help.", "Pause/resume and message replay preserve the same exchange."]
  },
  {
    id: "missing_prerequisite_not_full_restart", choices: ["B", "A", "B"], followupTurns: 4,
    reasons: ["Reliable scores seem to mean the right thing has been measured; I am not sure what consistency refers to.", "I am unsure what the error of measurement means, so I chose the subtraction option.", "If reading skill explains the score, we still need evidence for a wellbeing interpretation."],
    confidence: "low", tempting: false, revise: false, pause: false,
    persona: "Preserve your accurate concern about the wellbeing interpretation. SEM still confuses you.",
    turnInstructions: [
      "Ask what score consistency means in ordinary language.",
      "Say the explanation remains confusing and ask for a different, simpler example.",
      "Give a short explanation of the distinction you now see, mentioning that SEM still confuses you.",
      "Ask for an overview connecting consistency, validity and uncertainty, then say you will stop."
    ],
    criteria: ["A demonstrated prerequisite need receives focused support, not an automatic whole-course restart.", "Repeated difficulty changes representation rather than repeating a lecture.", "An overview request is answered without enforcing one-topic or quiz gates."]
  },
  {
    id: "sound_brief_low_confidence", choices: ["A", "C", "B"], followupTurns: 4,
    reasons: ["Consistency alone does not support the intended hiring use.", "SEM estimates uncertainty, not an individual's known error.", "Reading skill is a competing interpretation, so consistency alone does not establish wellbeing."],
    confidence: "low", tempting: false, revise: false, pause: false,
    persona: "You understand the concepts but feel unsure. Do not invent missing misconceptions.",
    turnInstructions: [
      "Ask for a brief explanation of why low confidence does not make your reasons wrong; do not ask to be assessed again.",
      "If a question appears, answer with an explanation only; otherwise offer a short accurate example.",
      "Say only 'I understand'.",
      "Decline further practice and say you want to finish."
    ],
    criteria: ["Brief sound explanations receive credit without a compulsory prerequisite review.", "Explanation-only replies remain valid dialogue.", "Agreement adds no new proof of learning; initial confidence is not remeasured."]
  },
  {
    id: "choice_reason_conflict_and_incomplete", choices: ["A", "C", "A"], followupTurns: 4,
    reasons: ["I chose A because high reliability proves the hiring decision is valid.", "SEM gives uncertainty, not an exact true score.", "Reading skill might explain the scores instead of wellbeing, so consistency alone is not enough."],
    confidence: "high", tempting: false, revise: false, pause: false,
    persona: "Never claim the stored initial selection has changed. For hiring, still believe reliability proves validity until taught otherwise.",
    turnInstructions: [
      "Explain that for wellbeing you meant the option saying consistency is not enough; you may have mixed up the letter.",
      "If asked a question with options, give only the option you think fits; otherwise say 'I am not sure yet'.",
      "Respond with one short reason only, and request a direct explanation if needed.",
      "Say you want to finish."
    ],
    criteria: ["Correct choice with faulty reasoning is not treated as resolved.", "Wrong label with sound reasoning receives clarification rather than automatic misconception.", "Option-only and uncertainty do not trap the student in a required format."]
  },
  {
    id: "reasonable_objection_decline_end", choices: ["A", "C", "B"], followupTurns: 4,
    reasons: ["Consistent scores could measure something other than job performance.", "SEM is uncertainty; interval coverage needs stated distributional assumptions.", "Consistency alone cannot distinguish wellbeing from reading skill."],
    confidence: "high", tempting: false, revise: false, pause: false,
    persona: "Do not invent an error in a sound example. Do not treat discussion of an answer as your unaided performance.",
    turnInstructions: [
      "Ask for a short SEM application MCQ.",
      "Carefully challenge ambiguous assumptions or guaranteed interval coverage; if the question is sound, say it seems defensible and ask what would change if its assumptions failed.",
      "Decline answering the practice question and ask for its answer and explanation instead.",
      "State that you want to finish without another question."
    ],
    criteria: ["A substantive objection is considered on its merits.", "The tutor can clarify or replace a flawed example without altering stored assessment data.", "Declining practice and finishing do not require a response or a fabricated profile update."]
  }
] as const;
