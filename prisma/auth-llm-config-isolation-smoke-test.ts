import { PrismaClient } from "@prisma/client";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { getLlmReadiness } from "../src/lib/llm/readiness";
import { evaluateOperationalExecutionReadiness } from "../src/lib/operational/guarded-agent-integration";
import { getTeacherPasswordAccount } from "../src/lib/services/account-security/teacher-account-security";
import { getTeacherAssessmentDashboard } from "../src/lib/services/teacher-dashboard/assessment-dashboard";
import {
  accountSecuritySmokePrefix,
  assert,
  cleanupAccountSecuritySmokeUsers,
  createSmokeStudent,
  createSmokeTeacher
} from "./account-security-smoke-helpers";

const prisma = new PrismaClient();

async function login(userId: string, password: string) {
  return loginPost(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        password,
        access_code: password
      })
    })
  );
}

async function main() {
  const prefix = accountSecuritySmokePrefix("auth_llm_config_isolation");
  const previousOperationalAgentMode = process.env.OPERATIONAL_AGENT_MODE;
  const previousLlmProvider = process.env.LLM_PROVIDER;
  const previousLiveCallsEnabled = process.env.LLM_LIVE_CALLS_ENABLED;

  await cleanupAccountSecuritySmokeUsers(prisma, prefix);

  const teacherPassword = "AuthLlmIsolationTeacher!31z";
  const studentPassword = "AuthLlmIsolationStudent!31z";
  const teacher = await createSmokeTeacher({
    prisma,
    userId: `${prefix}teacher`,
    password: teacherPassword
  });
  const student = await createSmokeStudent({
    prisma,
    userId: `${prefix}student`,
    password: studentPassword,
    teacher
  });

  try {
    process.env.OPERATIONAL_AGENT_MODE = "invalid_mode_for_auth_isolation";
    process.env.LLM_PROVIDER = "mock";
    process.env.LLM_LIVE_CALLS_ENABLED = "false";

    const teacherLogin = await login(teacher.user_id, teacherPassword);
    assert(teacherLogin.status === 200, "Teacher username/password login should not depend on optional operational LLM config.");
    const teacherLoginBody = await teacherLogin.json() as { user?: { role?: string; user_id?: string } };
    assert(teacherLoginBody.user?.role === "teacher_researcher", "Teacher login should return teacher role.");

    const studentLogin = await login(student.user_id, studentPassword);
    assert(studentLogin.status === 200, "Student username/password login should not depend on optional operational LLM config.");
    const studentLoginBody = await studentLogin.json() as { user?: { role?: string; user_id?: string } };
    assert(studentLoginBody.user?.role === "student", "Student login should return student role.");

    const account = await getTeacherPasswordAccount({ userDbId: teacher.id, context: { prisma } });
    assert(account.user_id === teacher.user_id, "Teacher account management projection should remain available.");

    const dashboard = await getTeacherAssessmentDashboard({ teacher_user_db_id: teacher.id });
    assert(Array.isArray(dashboard.assessments), "Teacher dashboard service should remain available.");

    const operationalReadiness = await evaluateOperationalExecutionReadiness({
      agentName: "formative_value_and_planning_agent",
      checkDatabase: false,
      checkUsageGuard: false
    });
    assert(!operationalReadiness.allowed, "Operational agents should fail closed for invalid operational config.");
    assert(
      operationalReadiness.reason === "other_typed_configuration_error",
      "Invalid operational config should produce a typed configuration block."
    );
    assert(
      operationalReadiness.readinessSnapshot.sanitized_warnings.some((warning) =>
        warning.includes("OPERATIONAL_AGENT_MODE")
      ),
      "Operational readiness should identify OPERATIONAL_AGENT_MODE without printing values."
    );

    const llmStatus = await getLlmReadiness();
    assert(llmStatus.configuration_error, "LLM status should report invalid optional LLM configuration.");
    assert(
      JSON.stringify(llmStatus.configuration_error).includes("OPERATIONAL_AGENT_MODE"),
      "LLM status should identify the invalid OPERATIONAL_AGENT_MODE field."
    );

    console.log(
      JSON.stringify(
        {
          status: "passed",
          teacher_login_available_with_invalid_operational_mode: true,
          student_login_available_with_invalid_operational_mode: true,
          teacher_account_management_available: true,
          teacher_dashboard_available: true,
          operational_agents_blocked: true,
          llm_status_reports_invalid_configuration: true,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } finally {
    if (previousOperationalAgentMode === undefined) {
      delete process.env.OPERATIONAL_AGENT_MODE;
    } else {
      process.env.OPERATIONAL_AGENT_MODE = previousOperationalAgentMode;
    }
    if (previousLlmProvider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = previousLlmProvider;
    }
    if (previousLiveCallsEnabled === undefined) {
      delete process.env.LLM_LIVE_CALLS_ENABLED;
    } else {
      process.env.LLM_LIVE_CALLS_ENABLED = previousLiveCallsEnabled;
    }
    await cleanupAccountSecuritySmokeUsers(prisma, prefix);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
  process.exitCode = 1;
});
