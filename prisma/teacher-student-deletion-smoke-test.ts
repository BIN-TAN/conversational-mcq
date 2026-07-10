import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { ensureRosterDemoTeacher } from "./demo-roster-fixture";

const prisma = new PrismaClient();
const port = 3240;
const baseUrl = `http://localhost:${port}`;
const prefix = `teacher_student_deletion_smoke_${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanupPrefix() {
  await prisma.studentAccountDeletionEvent.deleteMany({
    where: { student_user_id_snapshot: { startsWith: prefix } }
  });

  const users = await prisma.user.findMany({
    where: { user_id: { startsWith: prefix } },
    select: { id: true, user_id: true }
  });
  const userIds = users.map((user) => user.id);
  const userPublicIds = users.map((user) => user.user_id);

  const assessments = await prisma.assessment.findMany({
    where: { assessment_public_id: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const sessions = await prisma.assessmentSession.findMany({
    where: {
      OR: [
        { user_db_id: { in: userIds } },
        { assessment_db_id: { in: assessmentIds } }
      ]
    },
    select: { id: true, session_public_id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const sessionPublicIds = sessions.map((session) => session.session_public_id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);
  const followupRounds = await prisma.followupRound.findMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } },
    select: { id: true }
  });
  const followupRoundIds = followupRounds.map((round) => round.id);
  const attempts = await prisma.activityRuntimeAttempt.findMany({
    where: {
      OR: [
        { student_public_id: { in: userPublicIds } },
        { session_public_id: { in: sessionPublicIds } },
        { activity_attempt_public_id: { startsWith: prefix } }
      ]
    },
    select: { id: true, activity_attempt_public_id: true }
  });
  const attemptPublicIds = attempts.map((attempt) => attempt.activity_attempt_public_id);
  const evidence = await prisma.activityMisconceptionEvidenceRecord.findMany({
    where: {
      OR: [
        { student_public_id: { in: userPublicIds } },
        { session_public_id: { in: sessionPublicIds } },
        { activity_attempt_id: { in: attemptPublicIds } }
      ]
    },
    select: { id: true }
  });
  const evidenceIds = evidence.map((record) => record.id);
  const agentCalls = await prisma.agentCall.findMany({
    where: {
      OR: [
        { assessment_session_db_id: { in: sessionIds } },
        { concept_unit_session_db_id: { in: conceptUnitSessionIds } },
        { followup_round_db_id: { in: followupRoundIds } }
      ]
    },
    select: { id: true }
  });
  const agentCallIds = agentCalls.map((call) => call.id);

  await prisma.conceptUnitSession.updateMany({
    where: { id: { in: conceptUnitSessionIds } },
    data: { latest_student_profile_db_id: null, latest_formative_decision_db_id: null }
  });
  await prisma.postActivityDiagnosticSnapshot.deleteMany({
    where: {
      OR: [
        { evidence_record_db_id: { in: evidenceIds } },
        { student_public_id: { in: userPublicIds } },
        { session_public_id: { in: sessionPublicIds } },
        { activity_attempt_id: { in: attemptPublicIds } }
      ]
    }
  });
  await prisma.activityMisconceptionEvidenceRecord.deleteMany({
    where: {
      OR: [
        { id: { in: evidenceIds } },
        { student_public_id: { in: userPublicIds } },
        { session_public_id: { in: sessionPublicIds } },
        { activity_attempt_id: { in: attemptPublicIds } }
      ]
    }
  });
  await prisma.activityRuntimeAttempt.deleteMany({
    where: {
      OR: [
        { id: { in: attempts.map((attempt) => attempt.id) } },
        { student_public_id: { in: userPublicIds } },
        { session_public_id: { in: sessionPublicIds } },
        { activity_attempt_public_id: { startsWith: prefix } }
      ]
    }
  });
  await prisma.workflowJob.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.workflowOverride.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.studentActionIdempotencyKey.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.conceptProgressionRecord.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.followupUpdateCycle.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.conversationTurn.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.processEvent.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
  await prisma.operationalAgentEffectiveResult.deleteMany({ where: { agent_call_db_id: { in: agentCallIds } } });
  await prisma.agentCall.deleteMany({ where: { id: { in: agentCallIds } } });
  await prisma.followupRound.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.formativeDecision.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.studentProfile.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.responsePackage.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } } });
  await prisma.conceptUnitSession.deleteMany({ where: { id: { in: conceptUnitSessionIds } } });
  await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.item.deleteMany({ where: { concept_unit: { assessment_db_id: { in: assessmentIds } } } });
  await prisma.conceptUnit.deleteMany({ where: { assessment_db_id: { in: assessmentIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
  await prisma.summativeOutcome.deleteMany({
    where: {
      OR: [
        { user_db_id: { in: userIds } },
        { user_id_snapshot: { startsWith: prefix } }
      ]
    }
  });
  await prisma.studentAccountEvent.deleteMany({ where: { student_user_db_id: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function waitForHealth(child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let exited = false;

  child.once("exit", () => {
    exited = true;
  });

  while (Date.now() - startedAt < 45_000) {
    if (exited) {
      throw new Error("Next dev server exited before health check passed.");
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.status === 200) {
        return;
      }
    } catch {
      // Server not ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Timed out waiting for Next dev server.");
}

async function login(payload: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { response, cookie };
}

async function jsonRequest<T>(path: string, cookie: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie,
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : null;
  return { response, text, body };
}

function assertPreviewIsSafe(text: string, forbiddenSecrets: string[] = []) {
  for (const value of [
    "password_hash",
    "access_code_hash",
    "correct_option",
    "correctness",
    "raw_output",
    "input_payload",
    "structured_payload",
    "process payload",
    "OPENAI_API_KEY",
    "DATABASE_URL",
    "SESSION_SECRET",
    ...forbiddenSecrets
  ]) {
    assert(!text.includes(value), `Deletion preview exposed forbidden data: ${value}`);
  }
}

async function createAssociatedStudentData(input: {
  teacherUserDbId: string;
  studentUserId: string;
}) {
  const student = await prisma.user.findUniqueOrThrow({
    where: { user_id_normalized: normalizeUserId(input.studentUserId) },
    select: { id: true, user_id: true }
  });
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: `${prefix}_assessment`,
      title: "Deletion smoke assessment",
      description: "Synthetic deletion smoke assessment.",
      status: "published",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      created_by_user_db_id: input.teacherUserDbId
    }
  });
  const concept = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: `${prefix}_concept`,
      assessment_db_id: assessment.id,
      title: "Deletion smoke concept",
      learning_objective: "Synthetic deletion smoke objective.",
      related_concept_description: "Synthetic deletion smoke concept description.",
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const item = await prisma.item.create({
    data: {
      item_public_id: `${prefix}_item_1`,
      concept_unit_db_id: concept.id,
      item_order: 1,
      item_stem: "Synthetic deletion smoke item stem.",
      options: [
        { label: "A", text: "Synthetic option A." },
        { label: "B", text: "Synthetic option B." },
        { label: "C", text: "Synthetic option C." },
        { label: "D", text: "Synthetic option D." }
      ],
      correct_option: "A",
      distractor_rationales: { B: "Synthetic rationale." },
      expected_reasoning_patterns: ["Synthetic reasoning."],
      possible_misconception_indicators: ["Synthetic misconception."],
      administration_rules: { no_feedback_during_initial_administration: true },
      included_in_published_set: true,
      status: "published",
      version: 1
    }
  });
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: `${prefix}_session`,
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "followup_active",
      workflow_mode_snapshot: "automatic",
      response_collection_mode_snapshot: "llm_assisted",
      current_concept_unit_db_id: concept.id,
      started_at: new Date(),
      last_activity_at: new Date()
    }
  });
  const conceptSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: concept.id,
      status: "followup_active",
      initial_started_at: new Date(),
      initial_completed_at: new Date(),
      followup_started_at: new Date(),
      followup_status: "active"
    }
  });
  await prisma.itemResponse.create({
    data: {
      concept_unit_session_db_id: conceptSession.id,
      item_db_id: item.id,
      selected_option: "B",
      correct_option_snapshot: "A",
      correctness: "not_scored",
      reasoning_text: "Synthetic reasoning placeholder for deletion smoke.",
      confidence_rating: "medium",
      item_response_time_ms: 1234,
      item_started_at: new Date(),
      item_submitted_at: new Date(),
      item_version_snapshot: 1,
      item_snapshot: { item_public_id: item.item_public_id, stem_redacted: true }
    }
  });
  await prisma.conversationTurn.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptSession.id,
      item_db_id: item.id,
      phase: "initial_item_administration",
      actor_type: "student",
      message_text: "Synthetic student message placeholder.",
      structured_payload: { redacted_fixture: true }
    }
  });
  await prisma.processEvent.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptSession.id,
      item_db_id: item.id,
      event_type: "option_clicked",
      event_category: "student_process",
      event_source: "frontend",
      payload: { redacted_fixture: true },
      occurred_at: new Date()
    }
  });
  await prisma.responsePackage.create({
    data: {
      concept_unit_session_db_id: conceptSession.id,
      package_type: "initial_three_item_package",
      payload: { redacted_fixture: true }
    }
  });
  const agentCall = await prisma.agentCall.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_session_db_id: conceptSession.id,
      agent_name: "formative_value_and_planning_agent",
      agent_version: "deletion-smoke-v1",
      model_name: "mock",
      provider: "mock",
      client_request_id: `${prefix}_client_request`,
      prompt_version: "deletion-smoke-prompt",
      schema_version: "deletion-smoke-schema",
      input_payload: { redacted_fixture: true },
      raw_output: { redacted_fixture: true },
      output_payload: { redacted_fixture: true },
      output_validated: true,
      call_status: "succeeded",
      started_at: new Date(),
      completed_at: new Date()
    }
  });
  await prisma.operationalAgentEffectiveResult.create({
    data: {
      agent_call_db_id: agentCall.id,
      agent_name: "formative_value_and_planning_agent",
      operational_context_type: "assessment_session",
      operational_context_public_id: session.session_public_id,
      invocation_key: `${prefix}_effective_result`,
      effective_result_version: "deletion-smoke-effective-v1",
      effective_validator_version: "deletion-smoke-validator-v1",
      deterministic_guard_version: "deletion-smoke-guard-v1",
      canonicalization_version: "deletion-smoke-canonical-v1",
      fallback_version: null,
      raw_output_status: "valid",
      raw_semantic_status: "valid",
      raw_safety_status: "valid",
      effective_semantic_status: "valid",
      effective_safety_status: "valid",
      effective_overall_status: "usable",
      effective_student_facing_usable: true,
      effective_workflow_usable: true,
      effective_output_json: { redacted_fixture: true },
      effective_actions_json: { redacted_fixture: true },
      warnings_json: [],
      effective_result_hash: `${prefix}_effective_hash`
    }
  });
  const activityAttempt = await prisma.activityRuntimeAttempt.create({
    data: {
      activity_attempt_public_id: `${prefix}_activity_attempt`,
      session_public_id: session.session_public_id,
      student_public_id: student.user_id,
      assessment_public_id: assessment.assessment_public_id,
      concept_unit_id: concept.concept_unit_public_id,
      source_activity_packet_ref: { redacted_fixture: true },
      activity_family: "distractor_contrast",
      diagnostic_purpose: "distractor_misconception_probe",
      generation_source: "live_llm",
      first_turn_agent_call_db_id: agentCall.id,
      status: "completed",
      limitations: []
    }
  });
  const evidence = await prisma.activityMisconceptionEvidenceRecord.create({
    data: {
      evidence_public_id: `${prefix}_evidence`,
      session_public_id: session.session_public_id,
      student_public_id: student.user_id,
      assessment_public_id: assessment.assessment_public_id,
      concept_unit_id: concept.concept_unit_public_id,
      activity_attempt_id: activityAttempt.activity_attempt_public_id,
      source_activity_packet_ref: { redacted_fixture: true },
      source_evaluator_agent_call_db_id: agentCall.id,
      schema_version: "deletion-smoke-evidence-v1",
      evaluation_source: "mock",
      review_only: false,
      runtime_servable_to_student: true,
      production_mode: "runtime",
      diagnostic_purpose: "distractor_misconception_probe",
      activity_family: "distractor_contrast",
      student_response_kind: "free_text",
      evidence_elicited_types: ["conceptual_boundary"],
      misconception_update_status: "weakened",
      evidence_quality: "limited",
      recommended_next_diagnostic_purpose: "independent_misconception_verification",
      student_safe_feedback: { redacted_fixture: true },
      safety_flags: [],
      limitations: [],
      evidence_packet: { redacted_fixture: true },
      evidence_hash: `${prefix}_evidence_hash`
    }
  });
  await prisma.postActivityDiagnosticSnapshot.create({
    data: {
      snapshot_public_id: `${prefix}_snapshot`,
      evidence_record_db_id: evidence.id,
      session_public_id: session.session_public_id,
      student_public_id: student.user_id,
      assessment_public_id: assessment.assessment_public_id,
      concept_unit_id: concept.concept_unit_public_id,
      activity_attempt_id: activityAttempt.activity_attempt_public_id,
      pre_activity_diagnostic_state: "developing",
      activity_update_status: "weakened",
      post_activity_diagnostic_state: "mixed_evidence",
      update_strength: "limited",
      evidence_quality: "limited",
      next_diagnostic_purpose: "independent_misconception_verification",
      student_safe_feedback: { redacted_fixture: true },
      limitations: [],
      snapshot_payload: { redacted_fixture: true }
    }
  });
  await prisma.summativeOutcome.create({
    data: {
      user_db_id: student.id,
      user_id_snapshot: student.user_id,
      outcome_name: "Synthetic deletion smoke outcome",
      outcome_score: 1,
      max_score: 2,
      assessment_date: new Date("2026-07-09T00:00:00.000Z"),
      uploaded_by_user_db_id: input.teacherUserDbId,
      notes: "Synthetic deletion smoke note."
    }
  });

  return {
    student,
    session,
    conceptSession,
    agentCall,
    activityAttempt,
    evidence
  };
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await cleanupPrefix();
  await ensureRosterDemoTeacher(prisma);
  const beforeAgentCalls = await prisma.agentCall.count();
  let output = "";
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "teacher-student-deletion-smoke-session-secret-32",
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: ""
    }
  });

  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  try {
    await waitForHealth(child);

    const teacher = await login({
      user_id: "teacher_demo",
      password: "teacher_demo_password"
    });
    assert(teacher.response.status === 200, "Teacher login should work.");
    const teacherDb = await prisma.user.findUniqueOrThrow({
      where: { user_id_normalized: normalizeUserId("teacher_demo") },
      select: { id: true }
    });

    const studentUserId = `${prefix}_student`;
    const created = await jsonRequest<{
      student: { user_id: string };
      one_time_credentials: Array<{ temporary_password?: string; temporary_access_code: string }>;
    }>("/api/teacher/students", teacher.cookie, {
      method: "POST",
      body: JSON.stringify({
        user_id: studentUserId,
        display_name: "Deletion Smoke Student",
        generate_password: true
      })
    });
    assert(created.response.status === 201, "Teacher should create deletion-smoke student.");
    const credential =
      created.body?.one_time_credentials[0]?.temporary_password ??
      created.body?.one_time_credentials[0]?.temporary_access_code ??
      "";
    assert(credential.length > 0, "Create response should include immediate one-time credential.");

    const fixture = await createAssociatedStudentData({
      teacherUserDbId: teacherDb.id,
      studentUserId
    });

    const studentLogin = await login({ user_id: studentUserId, access_code: credential });
    assert(studentLogin.response.status === 200, "Student login should work before deletion.");

    const studentPreview = await jsonRequest<unknown>(
      `/api/teacher/students/${encodeURIComponent(studentUserId)}/deletion/preview`,
      studentLogin.cookie
    );
    assert(studentPreview.response.status === 403, "Student user cannot access deletion preview API.");

    const teacherPreview = await jsonRequest<{
      student_id: string;
      counts: Record<string, number>;
      warning: string;
    }>(`/api/teacher/students/${encodeURIComponent(studentUserId)}/deletion/preview`, teacher.cookie);
    assert(teacherPreview.response.status === 200, "Teacher should preview deletion.");
    assert(teacherPreview.body?.student_id === studentUserId, "Preview should identify the student_id.");
    assert(teacherPreview.body?.counts.assessment_session_count === 1, "Preview should count sessions.");
    assert(teacherPreview.body?.counts.item_response_count === 1, "Preview should count item responses.");
    assert(teacherPreview.body?.counts.conversation_turn_count === 1, "Preview should count conversation turns.");
    assert(teacherPreview.body?.counts.process_event_count === 1, "Preview should count process events.");
    assert(teacherPreview.body?.counts.response_package_count === 1, "Preview should count response packages.");
    assert(teacherPreview.body?.counts.activity_runtime_count === 1, "Preview should count activity attempts.");
    assert(teacherPreview.body?.counts.post_activity_evidence_count === 1, "Preview should count activity evidence.");
    assert(teacherPreview.body?.counts.diagnostic_snapshot_count === 1, "Preview should count snapshots.");
    assert(teacherPreview.body?.counts.agent_call_summary_count === 1, "Preview should count agent calls.");
    assert(teacherPreview.body?.counts.summative_outcome_count === 1, "Preview should count summative outcomes.");
    assertPreviewIsSafe(teacherPreview.text, [credential]);

    const teacherDeleteAttempt = await jsonRequest<unknown>(
      `/api/teacher/students/${encodeURIComponent("teacher_demo")}/deletion`,
      teacher.cookie,
      {
        method: "POST",
        body: JSON.stringify({ student_id: "teacher_demo", delete_confirmation: "DELETE" })
      }
    );
    assert(
      teacherDeleteAttempt.response.status === 404,
      "Teacher account cannot be deleted through student deletion path."
    );

    const wrongConfirmation = await jsonRequest<unknown>(
      `/api/teacher/students/${encodeURIComponent(studentUserId)}/deletion`,
      teacher.cookie,
      {
        method: "POST",
        body: JSON.stringify({ student_id: studentUserId, delete_confirmation: "delete" })
      }
    );
    assert(wrongConfirmation.response.status === 400, "Wrong DELETE confirmation should fail.");

    const deletion = await jsonRequest<{
      deletion_event_public_id: string;
      deleted_counts: Record<string, number>;
    }>(`/api/teacher/students/${encodeURIComponent(studentUserId)}/deletion`, teacher.cookie, {
      method: "POST",
      body: JSON.stringify({ student_id: studentUserId, delete_confirmation: "DELETE" })
    });
    assert(deletion.response.status === 200, "Teacher should delete student after exact confirmation.");
    assert(deletion.body?.deletion_event_public_id, "Deletion should return a safe audit event ID.");
    assert(deletion.body?.deleted_counts.assessment_session_count === 1, "Deletion summary should include counts.");
    assertPreviewIsSafe(deletion.text, [credential]);

    assert(
      (await prisma.user.count({ where: { user_id_normalized: normalizeUserId(studentUserId) } })) === 0,
      "Deleted student user row should be gone."
    );
    assert(
      (await prisma.assessmentSession.count({ where: { id: fixture.session.id } })) === 0,
      "Associated assessment session should be deleted."
    );
    assert(
      (await prisma.itemResponse.count({ where: { concept_unit_session_db_id: fixture.conceptSession.id } })) === 0,
      "Associated item responses should be deleted."
    );
    assert(
      (await prisma.conversationTurn.count({ where: { assessment_session_db_id: fixture.session.id } })) === 0,
      "Associated conversation turns should be deleted."
    );
    assert(
      (await prisma.processEvent.count({ where: { assessment_session_db_id: fixture.session.id } })) === 0,
      "Associated process events should be deleted."
    );
    assert(
      (await prisma.responsePackage.count({ where: { concept_unit_session_db_id: fixture.conceptSession.id } })) === 0,
      "Associated response packages should be deleted."
    );
    assert(
      (await prisma.activityRuntimeAttempt.count({ where: { id: fixture.activityAttempt.id } })) === 0,
      "Associated activity attempt should be deleted."
    );
    assert(
      (await prisma.activityMisconceptionEvidenceRecord.count({ where: { id: fixture.evidence.id } })) === 0,
      "Associated activity evidence should be deleted."
    );
    assert(
      (await prisma.postActivityDiagnosticSnapshot.count({ where: { evidence_record_db_id: fixture.evidence.id } })) === 0,
      "Associated diagnostic snapshot should be deleted."
    );
    assert(
      (await prisma.agentCall.count({ where: { id: fixture.agentCall.id } })) === 0,
      "Associated agent call should be deleted."
    );
    assert(
      (await prisma.studentAccountDeletionEvent.count({
        where: { student_user_id_snapshot: studentUserId }
      })) === 1,
      "Safe deletion audit event should remain."
    );

    const listAfterDelete = await jsonRequest<{ students?: Array<{ user_id: string }> }>(
      `/api/teacher/students?search=${encodeURIComponent(studentUserId)}`,
      teacher.cookie
    );
    assert(listAfterDelete.response.status === 200, "Teacher list should load after deletion.");
    assert(
      !listAfterDelete.body?.students?.some((student) => student.user_id === studentUserId),
      "Deleted account should not appear in future student list."
    );

    const controlStudentId = `${prefix}_control`;
    const controlCreated = await jsonRequest<{
      student: { user_id: string; account_status: string };
    }>("/api/teacher/students", teacher.cookie, {
      method: "POST",
      body: JSON.stringify({ user_id: controlStudentId, generate_password: true })
    });
    assert(controlCreated.response.status === 201, "Teacher should create control student.");
    const deactivate = await jsonRequest<{ student: { account_status: string } }>(
      `/api/teacher/students/${encodeURIComponent(controlStudentId)}/deactivate`,
      teacher.cookie,
      { method: "POST" }
    );
    assert(deactivate.body?.student.account_status === "inactive", "Existing deactivate should still work.");
    const reactivate = await jsonRequest<{ student: { account_status: string } }>(
      `/api/teacher/students/${encodeURIComponent(controlStudentId)}/reactivate`,
      teacher.cookie,
      { method: "POST" }
    );
    assert(reactivate.body?.student.account_status === "active", "Existing reactivate should still work.");

    const afterAgentCalls = await prisma.agentCall.count();
    assert(
      afterAgentCalls === beforeAgentCalls,
      "Deletion smoke must not leave or create LLM agent calls beyond the deleted synthetic fixture."
    );

    console.log("Teacher-controlled student deletion smoke test passed. No OpenAI call was made.");
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    child.kill("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await cleanupPrefix();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
