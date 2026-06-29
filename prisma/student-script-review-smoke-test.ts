import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  assert,
  assertStudentVisibleTextIsSafe,
  cleanupSmokeStudentSessions,
  createSmokeStudent
} from "./student-mvp-smoke-helpers";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  getStudentSessionState,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "../src/lib/services/student-assessment/service";
import {
  demoAssessmentPublicId,
  ensureDemoStudentAssessment
} from "./demo-student-assessment-fixture";
import type { StudentSessionState } from "../src/lib/student-assessment-ui/types";

type Severity = "low" | "medium" | "high";
type ReviewIssue = {
  scenario: string;
  reviewer: string;
  severity: Severity;
  message: string;
};
type Scenario = {
  name: string;
  first_reason_attempts: string[];
  expected_nonadvancing_attempts?: number;
  expected_summary_fragment?: string;
};
type ScenarioResult = {
  name: string;
  session_public_id: string;
  final_state: string;
  first_attempt_states: string[];
  transcript_text: string;
  learning_profile: StudentSessionState["learning_profile"] | null | undefined;
  package_summary_text: string;
};

const prisma = new PrismaClient();

const scenarios: Scenario[] = [
  {
    name: "content_question_theta",
    first_reason_attempts: ["What is theta?", "I don't know the reason yet."],
    expected_nonadvancing_attempts: 1,
    expected_summary_fragment: "theta"
  },
  {
    name: "procedural_question",
    first_reason_attempts: [
      "Can I write one sentence?",
      "Theta belongs to the person, while item difficulty belongs to the item."
    ],
    expected_nonadvancing_attempts: 1
  },
  {
    name: "explicit_idk",
    first_reason_attempts: ["I don't know the reason yet."],
    expected_nonadvancing_attempts: 0
  },
  {
    name: "gibberish_then_repair",
    first_reason_attempts: [
      "zzzzzzzz",
      "Theta is the person estimate and the item parameter is about the item."
    ],
    expected_nonadvancing_attempts: 1
  },
  {
    name: "gibberish_twice_then_unknown",
    first_reason_attempts: [
      "zzzzzzzz",
      "qwrtypsdf",
      "I don't know the reason yet."
    ],
    expected_nonadvancing_attempts: 2
  },
  {
    name: "accidental_incomplete_reasoning",
    first_reason_attempts: [
      "I think",
      "I think theta is the person location, while difficulty is about the item."
    ],
    expected_nonadvancing_attempts: 1
  },
  {
    name: "answer_request",
    first_reason_attempts: [
      "Which option is the correct answer?",
      "I don't know the reason yet."
    ],
    expected_nonadvancing_attempts: 1
  },
  {
    name: "affective_confused",
    first_reason_attempts: [
      "I'm confused.",
      "I don't know the reason yet."
    ],
    expected_nonadvancing_attempts: 1
  },
  {
    name: "edit_request",
    first_reason_attempts: [
      "I want to change my reason.",
      "The item feature changes, but theta is still about the person."
    ],
    expected_nonadvancing_attempts: 1
  },
  {
    name: "concise_usable_reasoning",
    first_reason_attempts: ["Theta describes the person, not the item difficulty."],
    expected_nonadvancing_attempts: 0
  },
  {
    name: "off_topic_then_repair",
    first_reason_attempts: [
      "I want pizza for lunch.",
      "The linked scale keeps theta comparable across forms."
    ],
    expected_nonadvancing_attempts: 1
  },
  {
    name: "content_question_parameters",
    first_reason_attempts: [
      "How does item discrimination work?",
      "I don't know the reason yet."
    ],
    expected_nonadvancing_attempts: 1,
    expected_summary_fragment: "item parameters"
  },
  {
    name: "weak_but_usable",
    first_reason_attempts: ["Theta is person ability and difficulty is item behavior."],
    expected_nonadvancing_attempts: 0
  },
  {
    name: "tempting_reason_content_question",
    first_reason_attempts: ["The item parameter wording makes B sound plausible."],
    expected_nonadvancing_attempts: 0
  }
];

function safeText(value: unknown) {
  return JSON.stringify(value).toLowerCase();
}

function hasForbiddenInitialLeak(text: string) {
  return /\b(answer key|correct option|the correct answer is|distractor rationale|system prompt|structured output|agent call)\b/i.test(text);
}

async function finishRemainingItem(input: {
  studentDbId: string;
  sessionPublicId: string;
  prefix: string;
  state: StudentSessionState;
  itemIndex: number;
}) {
  const item = input.state.current_item;
  assert(item, `Expected item ${input.itemIndex}.`);
  const selectedOption = item.options[0]?.label;
  assert(selectedOption, `Item ${input.itemIndex} needs an option.`);
  let state = (
    await recordSelectedOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        selected_option: selectedOption,
        client_action_id: `${input.prefix}_item${input.itemIndex}_answer`
      }
    })
  ).state;
  state = (
    await recordReasoning({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        reasoning_text: `For item ${input.itemIndex}, theta is about the person and the item parameter is about the item.`,
        client_action_id: `${input.prefix}_item${input.itemIndex}_reason`
      }
    })
  ).state;
  state = (
    await recordConfidence({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        confidence_rating: "medium",
        client_action_id: `${input.prefix}_item${input.itemIndex}_confidence`
      }
    })
  ).state;
  state = (
    await recordTemptingOption({
      student_user_db_id: input.studentDbId,
      session_public_id: input.sessionPublicId,
      item_public_id: item.item_public_id,
      data: {
        no_tempting_option: true,
        client_action_id: `${input.prefix}_item${input.itemIndex}_tempting_no`
      }
    })
  ).state;

  return state;
}

async function runScenario(input: {
  scenario: Scenario;
  prefix: string;
  studentDbId: string;
}) {
  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: input.studentDbId,
    assessment_public_id: demoAssessmentPublicId
  });
  let state = await startConceptUnitInitialAdministration({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: started.state.current_concept_unit?.concept_unit_public_id ?? ""
  });
  const firstItem = state.current_item;
  assert(firstItem, `${input.scenario.name}: expected first item.`);
  const selectedOption = firstItem.options[0]?.label;
  const temptingOption = firstItem.options.find((option) => option.label !== selectedOption)?.label;
  assert(selectedOption, `${input.scenario.name}: first item needs selected option.`);
  assert(temptingOption, `${input.scenario.name}: first item needs tempting option.`);
  const firstAttemptStates: string[] = [];

  state = (
    await recordSelectedOption({
      student_user_db_id: input.studentDbId,
      session_public_id: started.session.session_public_id,
      item_public_id: firstItem.item_public_id,
      data: {
        selected_option: selectedOption,
        client_action_id: `${input.prefix}_${input.scenario.name}_answer`
      }
    })
  ).state;

  for (const [index, message] of input.scenario.first_reason_attempts.entries()) {
    state = (
      await recordReasoning({
        student_user_db_id: input.studentDbId,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          reasoning_text: message,
          client_action_id: `${input.prefix}_${input.scenario.name}_reason_${index}`
        }
      })
    ).state;
    firstAttemptStates.push(state.assessment_state);
  }

  assert(
    state.assessment_state === "AWAIT_CONFIDENCE",
    `${input.scenario.name}: final first-item reason should advance to confidence.`
  );
  state = (
    await recordConfidence({
      student_user_db_id: input.studentDbId,
      session_public_id: started.session.session_public_id,
      item_public_id: firstItem.item_public_id,
      data: {
        confidence_rating: "medium",
        client_action_id: `${input.prefix}_${input.scenario.name}_confidence`
      }
    })
  ).state;

  if (input.scenario.name === "tempting_reason_content_question") {
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          tempting_option: temptingOption,
          client_action_id: `${input.prefix}_${input.scenario.name}_tempting`
        }
      })
    ).state;
    assert(
      state.assessment_state === "AWAIT_TEMPTING_REASON",
      "Tempting option should ask for a reason."
    );
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          tempting_option_reason: "What does item discrimination mean?",
          client_action_id: `${input.prefix}_${input.scenario.name}_tempting_question`
        }
      })
    ).state;
    firstAttemptStates.push(state.assessment_state);
    assert(
      state.assessment_state === "AWAIT_TEMPTING_REASON",
      "Content question in tempting reason should not advance."
    );
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          tempting_option_reason: "It sounded related to how steep the item curve is.",
          client_action_id: `${input.prefix}_${input.scenario.name}_tempting_reason`
        }
      })
    ).state;
  } else {
    state = (
      await recordTemptingOption({
        student_user_db_id: input.studentDbId,
        session_public_id: started.session.session_public_id,
        item_public_id: firstItem.item_public_id,
        data: {
          no_tempting_option: true,
          client_action_id: `${input.prefix}_${input.scenario.name}_tempting_no`
        }
      })
    ).state;
  }

  for (let index = 2; index <= 3; index += 1) {
    state = await finishRemainingItem({
      studentDbId: input.studentDbId,
      sessionPublicId: started.session.session_public_id,
      prefix: `${input.prefix}_${input.scenario.name}`,
      state,
      itemIndex: index
    });
  }

  assert(
    state.assessment_state === "PACKAGE_REVIEW",
    `${input.scenario.name}: expected package review after three items.`
  );
  state = (
    await completeInitialConceptUnitAdministration({
      student_user_db_id: input.studentDbId,
      session_public_id: started.session.session_public_id,
      concept_unit_public_id: state.current_concept_unit?.concept_unit_public_id ?? ""
    })
  ).state;
  const transcript = await getStudentSafeTranscript({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id
  });
  const transcriptText = transcript.transcript.map((turn) => turn.message_text).join("\n");
  const latestState = await getStudentSessionState({
    student_user_db_id: input.studentDbId,
    session_public_id: started.session.session_public_id
  });

  return {
    name: input.scenario.name,
    session_public_id: started.session.session_public_id,
    final_state: latestState.assessment_state,
    first_attempt_states: firstAttemptStates,
    transcript_text: transcriptText,
    learning_profile: latestState.learning_profile,
    package_summary_text: transcriptText
  } satisfies ScenarioResult;
}

function reviewScenario(result: ScenarioResult, scenario: Scenario): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const nonAdvancing = result.first_attempt_states.filter((state) =>
    state === "AWAIT_REASON" || state === "AWAIT_TEMPTING_REASON"
  ).length;

  if (nonAdvancing < (scenario.expected_nonadvancing_attempts ?? 0)) {
    issues.push({
      scenario: result.name,
      reviewer: "procedure",
      severity: "high",
      message: "Expected non-advancing repair/defer behavior was not observed."
    });
  }

  if (result.final_state !== "FORMATIVE_ACTIVITY") {
    issues.push({
      scenario: result.name,
      reviewer: "procedure",
      severity: "high",
      message: `Expected FORMATIVE_ACTIVITY after package analysis, got ${result.final_state}.`
    });
  }

  if (hasForbiddenInitialLeak(result.transcript_text)) {
    issues.push({
      scenario: result.name,
      reviewer: "answer_key_safety",
      severity: "high",
      message: "Student-visible transcript contains protected/internal wording."
    });
  }

  if (scenario.expected_summary_fragment && !result.package_summary_text.toLowerCase().includes(scenario.expected_summary_fragment)) {
    issues.push({
      scenario: result.name,
      reviewer: "content_question",
      severity: "medium",
      message: "Deferred content concern was not visible in the post-package summary."
    });
  }

  if (
    /\bWhat you did well:|Still developing:|Reasoning detail:|Current focus:/i.test(result.package_summary_text)
  ) {
    issues.push({
      scenario: result.name,
      reviewer: "feedback_style",
      severity: "high",
      message: "Post-package feedback still contains visible template headings."
    });
  }

  if (!result.learning_profile) {
    issues.push({
      scenario: result.name,
      reviewer: "learning_profile",
      severity: "high",
      message: "Student-safe learning profile was not generated."
    });
  } else {
    const profileKeys = Object.keys(result.learning_profile).sort();
    const expectedKeys = ["mostly_understood", "needs_more_work", "still_developing", "updated_at"].sort();
    if (JSON.stringify(profileKeys) !== JSON.stringify(expectedKeys)) {
      issues.push({
        scenario: result.name,
        reviewer: "learning_profile",
        severity: "high",
        message: `Unexpected profile keys: ${profileKeys.join(", ")}.`
      });
    }
    if (safeText(result.learning_profile).includes("not enough evidence yet") && result.name === "concise_usable_reasoning") {
      issues.push({
        scenario: result.name,
        reviewer: "learning_profile",
        severity: "low",
        message: "Profile used a fallback phrase for a usable-reasoning scenario."
      });
    }
  }

  return issues;
}

async function main() {
  process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.OPERATIONAL_AGENT_MODE = "disabled";

  await ensureDemoStudentAssessment(prisma);
  const prefix = `phase18_script_${Date.now()}_${randomUUID().slice(0, 8)}`;

  try {
    const results: ScenarioResult[] = [];
    const issues: ReviewIssue[] = [];

    for (const scenario of scenarios) {
      const student = await createSmokeStudent({
        prisma,
        prefix: `${prefix}_${scenario.name}`,
        accessCode: "phase18_script_access"
      });
      const scenarioSessionPublicIds: string[] = [];

      try {
        const result = await runScenario({
          scenario,
          prefix,
          studentDbId: student.id
        });
        scenarioSessionPublicIds.push(result.session_public_id);
        assertStudentVisibleTextIsSafe(result.transcript_text);
        results.push(result);
        issues.push(...reviewScenario(result, scenario));
      } finally {
        await cleanupSmokeStudentSessions({
          prisma,
          userDbId: student.id,
          sessionPublicIds: scenarioSessionPublicIds
        });
      }
    }

    const highIssues = issues.filter((issue) => issue.severity === "high");
    const outputDir = path.join(process.cwd(), ".data/student-script-review-smoke");
    const outputPath = path.join(outputDir, `student-script-review-${Date.now()}.json`);
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          reviewer_version: "student-script-review-smoke-v1",
          scenario_count: scenarios.length,
          high_severity_count: highIssues.length,
          issues,
          scenarios: results.map((result) => ({
            name: result.name,
            session_public_id: result.session_public_id,
            final_state: result.final_state,
            first_attempt_states: result.first_attempt_states,
            learning_profile: result.learning_profile
          }))
        },
        null,
        2
      )
    );

    assert(highIssues.length === 0, `Script review found high-severity issues. See ${outputPath}`);
    console.log(
      JSON.stringify(
        {
          ok: true,
          scenario_count: scenarios.length,
          issues: issues.length,
          high_severity_count: highIssues.length,
          output_path: outputPath
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  await prisma.$disconnect();
  console.error(error);
  process.exit(1);
});
