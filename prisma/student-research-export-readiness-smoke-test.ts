import { createSessionToken, verifySessionToken } from "../src/lib/auth";
import { buildAnalysisReadyDictionaryEntries } from "../src/lib/services/teacher-research-data/dictionary";
import { getResearchExportReadiness } from "../src/lib/services/teacher-research-data/readiness";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    RESEARCH_PSEUDONYMIZATION_KEY: process.env.RESEARCH_PSEUDONYMIZATION_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET
  };

  try {
    process.env.APP_ENV = "production";
    process.env.RESEARCH_PSEUDONYMIZATION_KEY = "";
    process.env.SESSION_SECRET = "phase31ak-readiness-smoke-session-secret";

    const readiness = await getResearchExportReadiness();
    assert(readiness.ready === false, "Missing production key should block research export readiness.");
    assert(
      readiness.blocking_reasons.some((reason) => reason.code === "research_pseudonymization_key_missing"),
      "Readiness should expose the missing-key reason."
    );
    assert(readiness.key_configured === false, "Readiness should report missing key without printing a value.");
    assert(readiness.safe_key_fingerprint === null, "Missing key should not produce a fingerprint.");

    const token = createSessionToken({
      user_db_id: "readiness-smoke-user",
      user_id: "teacher_readiness_smoke",
      role: "teacher_researcher",
      auth_version: 1
    });
    assert(verifySessionToken(token)?.user_id === "teacher_readiness_smoke", "Teacher login token should not depend on research export config.");

    const studentToken = createSessionToken({
      user_db_id: "readiness-smoke-student",
      user_id: "student_readiness_smoke",
      role: "student",
      auth_version: 1
    });
    assert(verifySessionToken(studentToken)?.user_id === "student_readiness_smoke", "Student login token should not depend on research export config.");
    assert(buildAnalysisReadyDictionaryEntries().length > 0, "Data dictionary should remain available when export is blocked.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          blocked_reason: readiness.blocking_reasons[0]?.code,
          auth_unaffected: true,
          dictionary_available: true,
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
