import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { hashSecret } from "../src/lib/password";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

loadEnvConfig(process.cwd());

const PRIVATE_STAGING_SUFFIX = "_private_staging";
const PRIVATE_STAGING_HOST = "127.0.0.1";
const PRIVATE_STAGING_PORT = Number(process.env.PRIVATE_STAGING_PORT ?? 3200);
const PRIVATE_STAGING_BASE_URL =
  process.env.PRIVATE_STAGING_BASE_URL?.trim() ||
  `http://${PRIVATE_STAGING_HOST}:${PRIVATE_STAGING_PORT}`;
const PRIVATE_STAGING_REPORT_ROOT = path.join(process.cwd(), ".data", "private-staging");
const PRIVATE_STAGING_RUNTIME_DIR = path.join(PRIVATE_STAGING_REPORT_ROOT, "runtime");
const PRIVATE_STAGING_PID_FILE = path.join(PRIVATE_STAGING_RUNTIME_DIR, "processes.json");
const PRIVATE_STAGING_SESSION_SECRET =
  "phase8d-private-staging-session-secret-never-use-in-production";
const APPROVED_CONFIG_HASH = "58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2";
const APPROVED_MODEL = "gpt-5.4-mini-2026-03-17";
const APPROVED_CANARY_RUN = "olcr_20260626_j9ilznq";

const NAMESPACE = "phase8d";
const TEACHER_USER_ID = `${NAMESPACE}_teacher`;
const TEACHER_PASSWORD = "phase8d_teacher_password";
const STUDENT_ACCESS_CODE = "phase8d_student_access_code";
const ASSESSMENT_PUBLIC_ID = `${NAMESPACE}_assessment_guarded_live`;
const CONCEPT_PUBLIC_IDS = [1, 2].map((index) => `${NAMESPACE}_concept_${index}`);
const STUDENT_IDS = [1, 2, 3, 4, 5].map((index) => `${NAMESPACE}_student_${String(index).padStart(2, "0")}`);

type ProcessState = {
  app_pid: number | null;
  worker_pid: number | null;
  base_url: string;
  database_name: string;
  started_at: string;
  app_log: string;
  worker_log: string;
};

function defaultDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    "postgresql://conversational_mcq:conversational_mcq_dev_password@localhost:5432/conversational_mcq?schema=public"
  );
}

function privateStagingDatabaseUrl() {
  if (process.env.PRIVATE_STAGING_DATABASE_URL?.trim()) {
    assertPrivateStagingDatabaseUrl(process.env.PRIVATE_STAGING_DATABASE_URL);
    return process.env.PRIVATE_STAGING_DATABASE_URL;
  }

  const url = new URL(defaultDatabaseUrl());
  const currentName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const baseName = currentName.endsWith(PRIVATE_STAGING_SUFFIX)
    ? currentName
    : currentName
        .replace(/_live_canary_smoke_e2e$/, "")
        .replace(/_live_canary_e2e$/, "")
        .replace(/_e2e$/, "");
  url.pathname = `/${baseName.endsWith(PRIVATE_STAGING_SUFFIX) ? baseName : `${baseName}${PRIVATE_STAGING_SUFFIX}`}`;
  const value = url.toString();
  assertPrivateStagingDatabaseUrl(value);
  return value;
}

function databaseName(databaseUrl = privateStagingDatabaseUrl()) {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
}

function databaseUser(databaseUrl = privateStagingDatabaseUrl()) {
  return decodeURIComponent(new URL(databaseUrl).username || "conversational_mcq");
}

function assertPrivateStagingDatabaseUrl(databaseUrl: string) {
  const name = databaseNameFromUrl(databaseUrl);
  if (!name.endsWith(PRIVATE_STAGING_SUFFIX)) {
    throw new Error(`Refusing private staging database operation because '${name}' does not end with '${PRIVATE_STAGING_SUFFIX}'.`);
  }
  if (
    name === "conversational_mcq" ||
    name.endsWith("_e2e") ||
    name.endsWith("_live_canary_e2e") ||
    name.endsWith("_live_canary_smoke_e2e")
  ) {
    throw new Error(`Refusing private staging database operation on protected database '${name}'.`);
  }
}

function databaseNameFromUrl(databaseUrl: string) {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
}

function redactedDatabaseUrl(databaseUrl = privateStagingDatabaseUrl()) {
  const url = new URL(databaseUrl);
  if (url.password) {
    url.password = "REDACTED";
  }
  return url.toString();
}

function stagingEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: privateStagingDatabaseUrl(),
    SESSION_SECRET: process.env.SESSION_SECRET || PRIVATE_STAGING_SESSION_SECRET,
    COURSE_TIMEZONE: "America/Edmonton",
    PRIVATE_STAGING_MODE: "true",
    LLM_PROVIDER: "openai",
    LLM_LIVE_CALLS_ENABLED: "true",
    OPERATIONAL_AGENT_MODE: "guarded_live",
    OPERATIONAL_APPROVED_CONFIG_HASH: process.env.OPERATIONAL_APPROVED_CONFIG_HASH || APPROVED_CONFIG_HASH,
    OPERATIONAL_EFFECTIVE_RESULT_VERSION: "effective-system-eval-v2",
    OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: "effective-validator-v1",
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: "true",
    OPERATIONAL_AGENT_INTEGRATION_APPROVED_TARGETED_RUN_ID: "evr_20260624_bltzgtq",
    OPENAI_MODEL_ITEM_VERIFICATION: APPROVED_MODEL,
    OPENAI_MODEL_RESPONSE_COLLECTION: APPROVED_MODEL,
    OPENAI_MODEL_PROFILING: APPROVED_MODEL,
    OPENAI_MODEL_PLANNING: APPROVED_MODEL,
    OPENAI_MODEL_FOLLOWUP: APPROVED_MODEL,
    OPENAI_REASONING_EFFORT_ITEM_VERIFICATION: "low",
    OPENAI_REASONING_EFFORT_RESPONSE_COLLECTION: "low",
    OPENAI_REASONING_EFFORT_PROFILING: "low",
    OPENAI_REASONING_EFFORT_PLANNING: "low",
    OPENAI_REASONING_EFFORT_FOLLOWUP: "low",
    OPENAI_MAX_OUTPUT_TOKENS_ITEM_VERIFICATION: "3000",
    OPENAI_MAX_OUTPUT_TOKENS_RESPONSE_COLLECTION: "1500",
    OPENAI_MAX_OUTPUT_TOKENS_PROFILING: "4000",
    OPENAI_MAX_OUTPUT_TOKENS_PLANNING: "3000",
    OPENAI_MAX_OUTPUT_TOKENS_FOLLOWUP: "2500",
    OPENAI_MAX_RETRIES: "1",
    OPENAI_REQUEST_TIMEOUT_MS: "60000",
    ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW: "false",
    LLM_DAILY_STUDENT_CALL_LIMIT: "200",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "500000",
    LLM_DAILY_CLASS_CALL_LIMIT: "5000",
    LLM_DAILY_CLASS_TOKEN_LIMIT: "5000000",
    LLM_SESSION_CALL_LIMIT: "200",
    LLM_SESSION_TOKEN_LIMIT: "1000000",
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "100",
    LLM_USAGE_TIMEZONE: "America/Edmonton",
    WORKFLOW_JOB_POLL_INTERVAL_MS: "500",
    WORKFLOW_JOB_BASE_RETRY_MS: "1000",
    WORKFLOW_JOB_MAX_RETRY_MS: "5000",
    HOSTNAME: PRIVATE_STAGING_HOST,
    PORT: String(PRIVATE_STAGING_PORT),
    NEXT_TELEMETRY_DISABLED: "1",
    ...overrides
  } as unknown as NodeJS.ProcessEnv;

  delete env.OPERATIONAL_AGENT_INTEGRATION_ENABLED;
  delete env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE;
  return env;
}

function applyStagingEnv() {
  const env = stagingEnv();
  Object.assign(process.env, env);
  delete process.env.OPERATIONAL_AGENT_INTEGRATION_ENABLED;
  delete process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE;
}

function runCommand(command: string, args: string[], input: { env?: NodeJS.ProcessEnv; stdio?: "inherit" | "pipe"; timeoutMs?: number } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: input.env ?? process.env,
    encoding: "utf8",
    stdio: input.stdio ?? "pipe",
    timeout: input.timeoutMs
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : ""
      ].filter(Boolean).join("\n")
    );
  }

  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function dockerPostgres(command: string, args: string[], input?: string) {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", command, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Docker Postgres command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : ""
      ].filter(Boolean).join("\n")
    );
  }

  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function dockerPsql(sql: string, dbName = "postgres") {
  return dockerPostgres("psql", [
    "-U",
    databaseUser(),
    "-d",
    dbName,
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    sql
  ]);
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function databaseExists(dbName = databaseName()) {
  const escaped = dbName.replace(/'/g, "''");
  const result = dockerPsql(`SELECT 1 FROM pg_database WHERE datname='${escaped}'`, "postgres");
  return result.stdout.trim() === "1";
}

async function createDatabaseIfMissing() {
  const dbName = databaseName();
  assertPrivateStagingDatabaseUrl(privateStagingDatabaseUrl());
  if (await databaseExists(dbName)) {
    return false;
  }
  dockerPsql(`CREATE DATABASE "${dbName.replace(/"/g, "\"\"")}"`, "postgres");
  return true;
}

async function dropDatabaseIfPresent() {
  const dbName = databaseName();
  assertPrivateStagingDatabaseUrl(privateStagingDatabaseUrl());
  if (!(await databaseExists(dbName))) {
    return false;
  }
  const escaped = dbName.replace(/'/g, "''");
  dockerPsql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${escaped}' AND pid <> pg_backend_pid();`, "postgres");
  dockerPsql(`DROP DATABASE "${dbName.replace(/"/g, "\"\"")}"`, "postgres");
  return true;
}

function prismaClient() {
  return new PrismaClient({
    datasources: {
      db: {
        url: privateStagingDatabaseUrl()
      }
    }
  });
}

function itemPublicId(conceptIndex: number, itemOrder: number) {
  return `${NAMESPACE}_item_${conceptIndex}_${itemOrder}`;
}

const PRIVATE_STAGING_CONCEPTS = [
  {
    title: "Using evidence to support claims",
    learning_objective: "Use evidence to choose and justify a supported claim.",
    related_concept_description: "Generic evidence and claim relationship.",
    items: [
      {
        stem:
          "Evidence:\nA plant placed near a window grew taller and had greener leaves than a plant kept in a dark cabinet for the same number of days.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "Light may have helped the plant grow." },
          { label: "B", text: "The dark cabinet made the plant grow faster." },
          { label: "C", text: "The two plants grew exactly the same way." },
          { label: "D", text: "There is no evidence about plant growth." }
        ],
        expected_reasoning_patterns: ["Connects better plant growth to the plant receiving more light."],
        possible_misconception_indicators: ["Treats absence of light as helpful despite the comparison."]
      },
      {
        stem:
          "Evidence:\nA student read for 20 minutes each day for two weeks. At the end of the two weeks, the student could summarize longer passages with fewer missed details.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "Regular reading practice may have improved the student’s summaries." },
          { label: "B", text: "The student stopped reading after two weeks." },
          { label: "C", text: "Reading practice made the summaries worse." },
          { label: "D", text: "The evidence is about math practice, not reading." }
        ],
        expected_reasoning_patterns: ["Connects repeated reading practice to improved summaries."],
        possible_misconception_indicators: ["Ignores the before-and-after improvement."]
      },
      {
        stem:
          "Evidence:\nTwo identical cups of warm water were left on a table. One cup was covered with a lid, and one was left open. After 30 minutes, the covered cup was warmer.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "The lid may have helped the water keep heat." },
          { label: "B", text: "The open cup stayed warmer than the covered cup." },
          { label: "C", text: "Both cups became hotter over time." },
          { label: "D", text: "The lid changed the amount of water before the test began." }
        ],
        expected_reasoning_patterns: ["Uses the covered cup staying warmer as support for heat retention."],
        possible_misconception_indicators: ["Reverses which cup stayed warmer."]
      },
      {
        stem:
          "Evidence:\nA class tried two study methods for vocabulary. Students who practiced with examples remembered more words than students who copied the word list once.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "Practicing with examples may support vocabulary memory." },
          { label: "B", text: "Copying the word list once helped students remember more words." },
          { label: "C", text: "No students remembered any vocabulary words." },
          { label: "D", text: "The evidence compares handwriting styles, not study methods." }
        ],
        expected_reasoning_patterns: ["Connects example practice to remembering more words."],
        possible_misconception_indicators: ["Chooses the weaker study method despite the comparison."]
      }
    ]
  },
  {
    title: "Comparing evidence across situations",
    learning_objective: "Compare evidence across situations and select the strongest supported claim.",
    related_concept_description: "Generic comparison of evidence across conditions.",
    items: [
      {
        stem:
          "Evidence:\nA bike with fully inflated tires rolled farther down the same ramp than a bike with partly flat tires.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "Fully inflated tires may help the bike roll farther." },
          { label: "B", text: "Partly flat tires made the bike roll farther." },
          { label: "C", text: "Tire inflation had no visible relationship to distance." },
          { label: "D", text: "The evidence shows the ramp was changed between trials." }
        ],
        expected_reasoning_patterns: ["Compares the two tire conditions and the distance rolled."],
        possible_misconception_indicators: ["Ignores that the ramp was the same."]
      },
      {
        stem:
          "Evidence:\nA phone battery lasted 10 hours when the screen brightness was low and 6 hours when the screen brightness was high.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "Lower screen brightness may help the battery last longer." },
          { label: "B", text: "Higher screen brightness made the battery last longer." },
          { label: "C", text: "Screen brightness was not changed." },
          { label: "D", text: "The evidence shows the phone was not used." }
        ],
        expected_reasoning_patterns: ["Connects lower brightness to longer battery duration."],
        possible_misconception_indicators: ["Reverses the direction of the battery evidence."]
      },
      {
        stem:
          "Evidence:\nA paper towel absorbed 12 milliliters of water. A cloth towel of the same size absorbed 25 milliliters of water.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "The cloth towel absorbed more water than the paper towel." },
          { label: "B", text: "The paper towel absorbed more water than the cloth towel." },
          { label: "C", text: "Both towels absorbed exactly the same amount." },
          { label: "D", text: "The evidence does not compare towel absorbency." }
        ],
        expected_reasoning_patterns: ["Uses the measured amounts to compare absorbency."],
        possible_misconception_indicators: ["Misreads the larger measured amount."]
      },
      {
        stem:
          "Evidence:\nA soccer team completed more accurate passes after practicing short passing drills for three weeks. Their number of missed passes decreased during the same period.\n\nQuestion:\nWhich claim is best supported by the evidence?",
        options: [
          { label: "A", text: "Short passing drills may have helped the team pass more accurately." },
          { label: "B", text: "The team missed more passes after practicing." },
          { label: "C", text: "The evidence is about shooting practice, not passing." },
          { label: "D", text: "Practice made the team stop playing soccer." }
        ],
        expected_reasoning_patterns: ["Connects short passing drills to more accurate passes and fewer missed passes."],
        possible_misconception_indicators: ["Ignores the decrease in missed passes."]
      }
    ]
  }
] as const;

function itemSeed(conceptIndex: number, itemOrder: number) {
  const item = PRIVATE_STAGING_CONCEPTS[conceptIndex - 1]?.items[itemOrder - 1];

  if (!item) {
    throw new Error(`Missing private staging item seed for concept ${conceptIndex}, item ${itemOrder}.`);
  }

  return {
    item_public_id: itemPublicId(conceptIndex, itemOrder),
    item_order: itemOrder,
    item_stem: item.stem,
    options: item.options,
    correct_option: "A",
    distractor_rationales: {
      B: "B conflicts with or overstates the evidence.",
      C: "C misreads the comparison in the evidence.",
      D: "D does not match what the evidence describes."
    },
    expected_reasoning_patterns: item.expected_reasoning_patterns,
    possible_misconception_indicators: item.possible_misconception_indicators,
    administration_rules: { no_feedback_during_initial_administration: true },
    included_in_published_set: true,
    status: "published" as const,
    version: 1
  };
}

async function cleanupFixture(prisma: PrismaClient) {
  const assessments = await prisma.assessment.findMany({
    where: { assessment_public_id: { startsWith: NAMESPACE } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  if (assessmentIds.length > 0) {
    const sessions = await prisma.assessmentSession.findMany({
      where: { assessment_db_id: { in: assessmentIds } },
      select: { id: true }
    });
    const sessionIds = sessions.map((session) => session.id);
    const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
      where: { assessment_session_db_id: { in: sessionIds } },
      select: { id: true }
    });
    const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

    await prisma.conceptUnitSession.updateMany({
      where: { id: { in: conceptUnitSessionIds } },
      data: { latest_student_profile_db_id: null, latest_formative_decision_db_id: null }
    });
    await prisma.conceptProgressionRecord.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.workflowOverride.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.workflowJob.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.studentActionIdempotencyKey.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.followupUpdateCycle.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.conversationTurn.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.processEvent.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.agentCall.deleteMany({ where: { assessment_session_db_id: { in: sessionIds } } });
    await prisma.operationalAgentEffectiveResult.deleteMany({});
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
  }

  await prisma.summativeOutcome.deleteMany({ where: { user_id_snapshot: { startsWith: NAMESPACE } } });
  await prisma.user.deleteMany({ where: { user_id: { startsWith: NAMESPACE } } });
}

async function seedFixture(prisma: PrismaClient) {
  await cleanupFixture(prisma);
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret(TEACHER_PASSWORD),
    hashSecret(STUDENT_ACCESS_CODE)
  ]);
  const teacher = await prisma.user.create({
    data: {
      user_id: TEACHER_USER_ID,
      user_id_normalized: normalizeUserId(TEACHER_USER_ID),
      display_name: "Phase 8D Private Staging Teacher",
      role: "teacher_researcher",
      password_hash: teacherPasswordHash,
      account_status: "active",
      auth_version: 1
    }
  });

  for (const userId of STUDENT_IDS) {
    await prisma.user.create({
      data: {
        user_id: userId,
        user_id_normalized: normalizeUserId(userId),
        display_name: `Private Staging Student ${userId.slice(-2)}`,
        role: "student",
        access_code_hash: studentAccessCodeHash,
        account_status: "active",
        auth_version: 1,
        credential_updated_at: new Date()
      }
    });
  }

  const now = new Date();
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: ASSESSMENT_PUBLIC_ID,
      title: "Evidence reasoning practice",
      description: "Synthetic-only practice assessment for local private-staging browser walkthrough.",
      status: "published",
      workflow_mode: "automatic",
      response_collection_mode: "llm_assisted",
      release_at: new Date(now.getTime() - 60 * 60_000),
      close_at: new Date(now.getTime() + 14 * 24 * 60 * 60_000),
      created_by_user_db_id: teacher.id
    }
  });

  for (let conceptIndex = 1; conceptIndex <= 2; conceptIndex += 1) {
    const conceptSeed = PRIVATE_STAGING_CONCEPTS[conceptIndex - 1];

    const concept = await prisma.conceptUnit.create({
      data: {
        concept_unit_public_id: CONCEPT_PUBLIC_IDS[conceptIndex - 1],
        assessment_db_id: assessment.id,
        title: conceptSeed.title,
        learning_objective: conceptSeed.learning_objective,
        related_concept_description: conceptSeed.related_concept_description,
        administration_rules: { no_feedback_during_initial_administration: true },
        order_index: conceptIndex,
        status: "published",
        version: 1
      }
    });

    for (let itemOrder = 1; itemOrder <= 4; itemOrder += 1) {
      await prisma.item.create({
        data: {
          ...itemSeed(conceptIndex, itemOrder),
          concept_unit_db_id: concept.id
        }
      });
    }
  }

  for (let index = 0; index < STUDENT_IDS.length; index += 1) {
    const user = await prisma.user.findUniqueOrThrow({ where: { user_id: STUDENT_IDS[index] } });
    await prisma.summativeOutcome.create({
      data: {
        outcome_public_id: `${NAMESPACE}_outcome_final_${index + 1}`,
        user_db_id: user.id,
        user_id_snapshot: user.user_id,
        outcome_name: "private staging final score",
        outcome_score: new Prisma.Decimal(80 + index),
        max_score: new Prisma.Decimal(100),
        assessment_date: new Date("2026-06-26T00:00:00.000Z"),
        notes: "Synthetic private staging outcome.",
        uploaded_by_user_db_id: teacher.id
      }
    });
  }

  await writeWalkthroughChecklist();
  return fixtureSummary();
}

function fixtureSummary() {
  return {
    teacher: {
      user_id: TEACHER_USER_ID,
      password: TEACHER_PASSWORD
    },
    students: STUDENT_IDS.map((user_id) => ({
      user_id,
      access_code: STUDENT_ACCESS_CODE
    })),
    assessment_public_id: ASSESSMENT_PUBLIC_ID,
    concept_unit_public_ids: CONCEPT_PUBLIC_IDS,
    routes: browserRoutes(),
    classroom_validity: false,
    human_review_pending: true
  };
}

function browserRoutes() {
  return {
    home: PRIVATE_STAGING_BASE_URL,
    student_login: `${PRIVATE_STAGING_BASE_URL}/student/login`,
    student_assessment: `${PRIVATE_STAGING_BASE_URL}/student/assessment`,
    teacher_dashboard: `${PRIVATE_STAGING_BASE_URL}/teacher/dashboard`,
    teacher_students: `${PRIVATE_STAGING_BASE_URL}/teacher/students`,
    teacher_sessions: `${PRIVATE_STAGING_BASE_URL}/teacher/sessions`,
    teacher_export: `${PRIVATE_STAGING_BASE_URL}/teacher/data/export`,
    teacher_llm_audit: `${PRIVATE_STAGING_BASE_URL}/teacher/system/llm`
  };
}

function walkthroughMarkdown() {
  const routes = browserRoutes();
  return [
    "# Phase 8D Private Staging Walkthrough",
    "",
    "Synthetic-only local walkthrough. This is private staging readiness, not classroom validity.",
    "",
    "## Credentials",
    "",
    `- teacher: ${TEACHER_USER_ID} / ${TEACHER_PASSWORD}`,
    `- students: ${STUDENT_IDS.join(", ")}`,
    `- shared student access code: ${STUDENT_ACCESS_CODE}`,
    "",
    "## Routes",
    "",
    `- student login: ${routes.student_login}`,
    `- student assessment: ${routes.student_assessment}`,
    `- teacher dashboard: ${routes.teacher_dashboard}`,
    `- teacher students: ${routes.teacher_students}`,
    `- teacher sessions: ${routes.teacher_sessions}`,
    `- teacher export: ${routes.teacher_export}`,
    `- teacher LLM audit: ${routes.teacher_llm_audit}`,
    "",
    "## Checklist",
    "",
    "- [ ] Confirm `npm run staging:private:status` reports guarded-live mode and local-only URL.",
    "- [ ] Teacher login with the synthetic teacher account.",
    "- [ ] View classroom/student list and confirm only `phase8d_*` accounts are present.",
    "- [ ] `phase8d_student_01`: complete the chat-style one-question-at-a-time flow; confirm item evidence is visible, option and confidence highlight, reasoning has one active textarea, saved state is shown, and the response record is read-only.",
    "- [ ] `phase8d_student_02`: complete an initial item and confirm the review summary appears only after answer, reasoning, and confidence are saved.",
    "- [ ] `phase8d_student_03`: during follow-up, send an off-topic or prompt-injection style message; confirm neutral handling and no hidden prompt, credential, model metadata, or internal ID disclosure.",
    "- [ ] `phase8d_student_04`: reach follow-up, press Enter to send a message, use Shift+Enter for a newline, and ask to move on; confirm move-on remains student-led and no profile/formative labels are shown to the student.",
    "- [ ] `phase8d_student_05`: select an option, type reasoning, save and exit, then resume; confirm the selected option and reasoning are preserved.",
    "- [ ] Teacher opens Student sessions and confirms selected option, reasoning, confidence, timestamps, transcript, process events, and agent/effective-result audit are visible.",
    "- [ ] Teacher generates a master CSV export and confirms no secrets, credential data, or internal UUIDs are visible.",
    "- [ ] Run `npm run staging:private:report` and confirm `classroom_validity=false`.",
    "",
    "## Hard Blocks",
    "",
    "- No real roster import in `PRIVATE_STAGING_MODE=true`.",
    "- No public deployment; app binds to 127.0.0.1.",
    "- No real or deidentified student data.",
    "- No classroom-validity claim."
  ].join("\n");
}

async function writeWalkthroughChecklist() {
  await ensureDir(PRIVATE_STAGING_REPORT_ROOT);
  await writeFile(path.join(PRIVATE_STAGING_REPORT_ROOT, "walkthrough-checklist.md"), `${walkthroughMarkdown()}\n`);
}

async function canaryEvidenceStatus() {
  try {
    const { createOperationalLiveCanaryReport } = await import("../src/lib/services/operational-live-canary/service");
    const report = await createOperationalLiveCanaryReport(APPROVED_CANARY_RUN);
    return {
      available: true,
      run_public_id: APPROVED_CANARY_RUN,
      recommendation: report.recommendation,
      classroom_validity: report.classroom_validity,
      human_review_pending: report.human_review_pending,
      ai_review_complete: report.acceptance_gates.ai_review_complete,
      all_review_items_pass: report.acceptance_gates.all_review_items_pass,
      ready_for_private_staging:
        report.recommendation === "ready_for_private_staging_deployment" &&
        report.classroom_validity === false &&
        report.human_review_pending === true
    };
  } catch (error) {
    return {
      available: false,
      run_public_id: APPROVED_CANARY_RUN,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function guardedReadinessStatus() {
  applyStagingEnv();
  try {
    const { getGuardedOperationalAgentIntegrationReadiness } = await import("../src/lib/operational/guarded-agent-integration");
    const readiness = await getGuardedOperationalAgentIntegrationReadiness({ checkDatabase: true });
    return {
      operational_mode: readiness.mode,
      classroom_provider: readiness.config.provider,
      classroom_live_calls_enabled: readiness.config.live_calls_enabled,
      api_key_configured: readiness.config.openai_key_configured,
      approved_configuration_hash: readiness.approved_configuration_hash,
      active_configuration_hash: readiness.active_configuration_hash,
      live_call_permitted: readiness.live_call_permitted,
      blocking_reasons: readiness.blocking_reasons,
      typed_blocking_reasons: readiness.typed_blocking_reasons,
      sanitized_warnings: readiness.sanitized_warnings
    };
  } catch (error) {
    return {
      operational_mode: "unknown",
      live_call_permitted: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function waitForHealth(timeoutMs = 60_000) {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${PRIVATE_STAGING_BASE_URL}/api/health`, { cache: "no-store" });
      if (response.ok) {
        return true;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for private staging health: ${lastError instanceof Error ? lastError.message : "unknown"}`);
}

function isPidAlive(pid: number | null | undefined) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessState(): Promise<ProcessState | null> {
  if (!existsSync(PRIVATE_STAGING_PID_FILE)) {
    return null;
  }
  return JSON.parse(await readFile(PRIVATE_STAGING_PID_FILE, "utf8")) as ProcessState;
}

function spawnDetached(command: string, args: string[], logPath: string, env: NodeJS.ProcessEnv): ChildProcess {
  const fd = openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", fd, fd]
  });
  child.unref();
  return child;
}

async function stopProcess(pid: number | null | undefined) {
  if (!pid || !isPidAlive(pid)) {
    return false;
  }
  process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (isPidAlive(pid)) {
    process.kill(pid, "SIGKILL");
  }
  return true;
}

async function preflightCommand() {
  assertPrivateStagingDatabaseUrl(privateStagingDatabaseUrl());
  runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
  runCommand("git", ["check-ignore", "-q", ".env"]);
  runCommand("git", ["check-ignore", "-q", ".env.local"]);
  runCommand("git", ["check-ignore", "-q", ".data"]);
  const remoteConfigured = runCommand("git", ["remote", "-v"]).stdout.trim().length > 0;
  runCommand("docker", ["compose", "ps", "postgres"]);
  const exists = await databaseExists().catch(() => false);
  const canaryEvidence = await canaryEvidenceStatus();
  const readiness = await guardedReadinessStatus();
  const result = {
    status: "ok",
    phase: "8D private staging user walkthrough",
    database_name: databaseName(),
    database_url: redactedDatabaseUrl(),
    database_exists: exists,
    base_url: PRIVATE_STAGING_BASE_URL,
    local_only_bind_host: PRIVATE_STAGING_HOST,
    remote_configured: remoteConfigured,
    canary_evidence: canaryEvidence,
    guarded_live_readiness: readiness,
    hard_blocks: {
      real_roster_import_disabled: true,
      public_deployment: false,
      real_student_data_allowed: false,
      classroom_validity: false
    },
    no_provider_call_made: true
  };
  console.log(JSON.stringify(result, null, 2));
}

async function seedCommand() {
  assertPrivateStagingDatabaseUrl(privateStagingDatabaseUrl());
  runCommand("docker", ["compose", "up", "-d", "postgres"], { stdio: "inherit" });
  const created = await createDatabaseIfMissing();
  runCommand("npx", ["prisma", "migrate", "deploy"], {
    env: stagingEnv({ NODE_ENV: "development" }),
    stdio: "inherit",
    timeoutMs: 120_000
  });
  const prisma = prismaClient();
  try {
    const fixture = await seedFixture(prisma);
    console.log(JSON.stringify({
      status: "seeded",
      database_name: databaseName(),
      database_url: redactedDatabaseUrl(),
      database_created: created,
      fixture,
      walkthrough_checklist: path.join(PRIVATE_STAGING_REPORT_ROOT, "walkthrough-checklist.md"),
      no_provider_call_made: true
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function startCommand() {
  assertPrivateStagingDatabaseUrl(privateStagingDatabaseUrl());
  const existing = await readProcessState();
  if (existing?.app_pid && isPidAlive(existing.app_pid)) {
    console.log(JSON.stringify({
      status: "already_running",
      ...existing,
      app_alive: isPidAlive(existing.app_pid),
      worker_alive: isPidAlive(existing.worker_pid),
      routes: browserRoutes(),
      credentials: fixtureSummary(),
      no_provider_call_made: true
    }, null, 2));
    return;
  }

  const exists = await databaseExists().catch(() => false);
  if (!exists) {
    throw new Error("Private staging database is missing. Run npm run staging:private:seed first.");
  }

  const readiness = await guardedReadinessStatus();
  if (!("live_call_permitted" in readiness) || readiness.live_call_permitted !== true) {
    throw new Error(`Guarded-live readiness failed: ${JSON.stringify(readiness)}`);
  }

  await ensureDir(PRIVATE_STAGING_RUNTIME_DIR);
  await writeWalkthroughChecklist();
  const env = stagingEnv();
  runCommand("npm", ["run", "build"], { env, stdio: "inherit", timeoutMs: 180_000 });

  const appLog = path.join(PRIVATE_STAGING_RUNTIME_DIR, "app.log");
  const workerLog = path.join(PRIVATE_STAGING_RUNTIME_DIR, "worker.log");
  const app = spawnDetached("npm", ["run", "start", "--", "-H", PRIVATE_STAGING_HOST, "-p", String(PRIVATE_STAGING_PORT)], appLog, env);
  const worker = spawnDetached("npm", ["run", "workflow:worker"], workerLog, env);
  await waitForHealth();
  const state: ProcessState = {
    app_pid: app.pid ?? null,
    worker_pid: worker.pid ?? null,
    base_url: PRIVATE_STAGING_BASE_URL,
    database_name: databaseName(),
    started_at: new Date().toISOString(),
    app_log: appLog,
    worker_log: workerLog
  };
  await writeFile(PRIVATE_STAGING_PID_FILE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "started",
    ...state,
    routes: browserRoutes(),
    credentials: fixtureSummary(),
    walkthrough_checklist: path.join(PRIVATE_STAGING_REPORT_ROOT, "walkthrough-checklist.md"),
    no_provider_call_made: true
  }, null, 2));
}

async function statusCommand() {
  const state = await readProcessState();
  const health = await fetch(`${PRIVATE_STAGING_BASE_URL}/api/health`, { cache: "no-store" })
    .then((response) => ({ ok: response.ok, status: response.status }))
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  const result = {
    status: state?.app_pid && isPidAlive(state.app_pid) ? "running" : "stopped",
    base_url: PRIVATE_STAGING_BASE_URL,
    database_name: databaseName(),
    app_alive: isPidAlive(state?.app_pid),
    worker_alive: isPidAlive(state?.worker_pid),
    health,
    guarded_live_readiness: await guardedReadinessStatus(),
    routes: browserRoutes(),
    credentials: fixtureSummary(),
    walkthrough_checklist: path.join(PRIVATE_STAGING_REPORT_ROOT, "walkthrough-checklist.md"),
    no_provider_call_made: true
  };
  console.log(JSON.stringify(result, null, 2));
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

async function reportCommand() {
  const prisma = prismaClient();
  try {
    const assessment = await prisma.assessment.findUnique({
      where: { assessment_public_id: ASSESSMENT_PUBLIC_ID },
      select: { id: true }
    });
    const whereAssessment = assessment ? { assessment_db_id: assessment.id } : { assessment_db_id: "__missing__" };
    const sessionIds = assessment
      ? (await prisma.assessmentSession.findMany({ where: whereAssessment, select: { id: true } })).map((session) => session.id)
      : [];
    const [
      sessions,
      completedSessions,
      activeSessions,
      agentCalls,
      openaiAgentCalls,
      failedAgentCalls,
      effectiveResults,
      fallbackResults,
      workflowFailures,
      exportJobs,
      completedExports,
      processErrorEvents
    ] = await Promise.all([
      prisma.assessmentSession.count({ where: whereAssessment }),
      prisma.assessmentSession.count({ where: { ...whereAssessment, status: "completed" } }),
      prisma.assessmentSession.count({ where: { ...whereAssessment, status: "active" } }),
      prisma.agentCall.count({ where: { assessment_session_db_id: { in: sessionIds } } }),
      prisma.agentCall.count({ where: { assessment_session_db_id: { in: sessionIds }, provider: "openai" } }),
      prisma.agentCall.count({
        where: {
          assessment_session_db_id: { in: sessionIds },
          OR: [{ error_category: { not: null } }, { blocked_reason: { not: null } }]
        }
      }),
      prisma.operationalAgentEffectiveResult.count({}),
      prisma.operationalAgentEffectiveResult.count({ where: { fallback_applied: true } }),
      prisma.workflowJob.count({ where: { assessment_session_db_id: { in: sessionIds }, status: "failed" } }),
      prisma.exportJob.count({}),
      prisma.exportJob.count({ where: { status: "completed" } }),
      prisma.processEvent.count({
        where: {
          assessment_session_db_id: { in: sessionIds },
          OR: [
            { event_type: { contains: "error" } },
            { event_type: { contains: "failed" } },
            { event_type: { contains: "validation_failure" } }
          ]
        }
      })
    ]);
    const costs = await prisma.agentCall.aggregate({
      where: { assessment_session_db_id: { in: sessionIds }, provider: "openai" },
      _sum: { estimated_cost: true, total_tokens: true }
    });
    const latestExports = await prisma.exportJob.findMany({
      orderBy: { created_at: "desc" },
      take: 5,
      select: {
        export_public_id: true,
        status: true,
        row_count: true,
        export_schema_version: true,
        created_at: true,
        completed_at: true,
        error_message: true
      }
    });
    const report = {
      label: "Phase 8D private staging walkthrough report",
      classroom_validity: false,
      human_review_pending: true,
      real_student_data_used: false,
      public_deployment: false,
      database_name: databaseName(),
      base_url: PRIVATE_STAGING_BASE_URL,
      assessment_public_id: ASSESSMENT_PUBLIC_ID,
      completed_student_sessions: completedSessions,
      active_student_sessions: activeSessions,
      total_student_sessions: sessions,
      agent_calls: agentCalls,
      openai_agent_calls: openaiAgentCalls,
      provider_requests_estimated_from_agent_calls: openaiAgentCalls,
      estimated_cost_usd: decimalToNumber(costs._sum.estimated_cost),
      total_tokens: Number(costs._sum.total_tokens ?? 0),
      failures: {
        agent_call_failures_or_blocks: failedAgentCalls,
        workflow_failures: workflowFailures,
        student_facing_error_events: processErrorEvents
      },
      teacher_visible_audit_records: {
        agent_calls: agentCalls,
        operational_effective_results: effectiveResults,
        fallback_effective_results: fallbackResults
      },
      export_privacy_checks: {
        export_jobs: exportJobs,
        completed_exports: completedExports,
        latest_exports: latestExports,
        secret_files_checked_into_git: false,
        internal_uuid_export_check: "verify downloaded CSV manually from teacher export page"
      },
      hard_blocks: {
        real_roster_import_disabled: true,
        public_deployment: false,
        classroom_validity: false
      },
      no_provider_call_made_by_report: true
    };
    await ensureDir(PRIVATE_STAGING_REPORT_ROOT);
    await writeFile(path.join(PRIVATE_STAGING_REPORT_ROOT, "latest-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupCommand() {
  const state = await readProcessState();
  const stoppedApp = await stopProcess(state?.app_pid);
  const stoppedWorker = await stopProcess(state?.worker_pid);
  const dropped = await dropDatabaseIfPresent();
  await rm(PRIVATE_STAGING_REPORT_ROOT, { recursive: true, force: true });
  console.log(JSON.stringify({
    status: "cleaned",
    stopped_app: stoppedApp,
    stopped_worker: stoppedWorker,
    dropped_database: dropped,
    database_name: databaseName(),
    no_provider_call_made: true
  }, null, 2));
}

async function main() {
  const command = process.argv[2] ?? "preflight";
  if (command === "preflight") return preflightCommand();
  if (command === "seed") return seedCommand();
  if (command === "start") return startCommand();
  if (command === "status") return statusCommand();
  if (command === "report") return reportCommand();
  if (command === "cleanup") return cleanupCommand();
  throw new Error(`Unknown private staging command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
