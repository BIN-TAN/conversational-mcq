export const FRESH_DIALOGUE_CASES = [
  {
    id: "supported_example_then_numeric_substitution",
    messages: [
      "Please show me one worked example for consistency versus validity and for SEM. I want an explanation, not a quiz.",
      "Using your example: consistency is not enough evidence for the intended interpretation. If the score is 82 and SEM is 4, 78 to 86 is an illustrative uncertainty range, not a guaranteed true score. I am following the pattern you just showed me."
    ],
    expected: ["Explain accurately without forcing a quiz; no demonstrated correction yet.", "Credit supported reasoning without labeling it independent robust transfer."],
    forbid_sound: [true, false], forbid_robust: [true, true], must_retain: [[0, 1], []], pause: false
  },
  {
    id: "new_context_boundary_reasoning",
    messages: [
      "Reliable scores alone cannot justify a placement decision: consistent reading demands might obscure the mathematics we mean to assess. We need evidence supporting the mathematical interpretation for these students. I still want to discuss uncertainty next.",
      "Here is a different issue I thought of: two examinees could have the same observed score and SEM but different unknown errors, so subtracting SEM would give an unjustified identical correction. A larger SEM should make a cutoff decision less certain, not automatically lower everyone's score. Content coverage and language accessibility evidence would still be needed for the intended placement use even if measurement error were small."
    ],
    expected: ["Credit the validity reasoning; retain untested SEM.", "Recognize independently justified boundary reasoning, with any transfer judgment tied to this sampled context."],
    forbid_sound: [true, false], forbid_robust: [true, false], must_retain: [[1], []], pause: false
  },
  {
    id: "self_confidence_not_calibration",
    messages: [
      "I am completely confident that subtracting SEM fixes my observed score, and a reliable test must be valid. Is that right?",
      "I see two different limits now: stable scores can consistently reflect something other than the intended construct, and SEM gives uncertainty rather than my signed error. I am only a little confident in my explanation, though."
    ],
    expected: ["Challenge both explicit errors, not the student's willingness to participate.", "Credit correction; log self-reported uncertainty separately rather than replacing the initial confidence rating."],
    forbid_sound: [true, false], forbid_robust: [true, true], must_retain: [[0, 1], []], pause: false
  },
  {
    id: "reported_claim_not_personal_endorsement",
    messages: [
      "A classmate said 'SEM tells the exact true score.' I think that is wrong because it is an uncertainty estimate, not the signed error for an individual. I am quoting the claim to reject it. I have not resolved my reliability/validity confusion.",
      "For the other point, does high reliability prove validity? That is a question I still have, not my conclusion. Please explain it without adding practice questions."
    ],
    expected: ["Recognize the explicit SEM rejection; retain reliability confusion.", "Answer the uncertainty directly; do not convert a question into newly confirmed endorsement or declare mastery."],
    forbid_sound: [true, true], forbid_robust: [true, true], must_retain: [[0], [0]], pause: false
  },
  {
    id: "corrected_then_reappearing_error",
    messages: [
      "I reject the claim that reliability proves validity. Repeated scores might consistently measure the wrong construct, so separate evidence for the intended interpretation is necessary. But I still believe SEM tells the exact true score.",
      "I changed my mind again. With almost perfect reliability, I now think no separate validity evidence is needed. I also still think SEM can give the exact true score."
    ],
    expected: ["Credit only the corrected validity reasoning; retain SEM.", "Notice renewed validity error, address both, and do not preserve an unjustified current mastery judgment."],
    forbid_sound: [true, true], forbid_robust: [true, true], must_retain: [[1], [1]], pause: false
  },
  {
    id: "uncertainty_then_stop_without_mastery",
    messages: [
      "I don't know how either idea works. Please explain both simply. Is a score plus or minus SEM guaranteed to contain the true score?",
      "I have read it, but I cannot explain it yet. I need a break now; please pause without testing me."
    ],
    expected: ["Explain both and reject guaranteed-interval interpretation; no diagnosis of disengagement.", "Respect pause, retain unresolved evidence, and do not equate reading/assent with learning."],
    forbid_sound: [true, true], forbid_robust: [true, true], must_retain: [[0, 1], [0, 1]], pause: true
  }
] as const;
