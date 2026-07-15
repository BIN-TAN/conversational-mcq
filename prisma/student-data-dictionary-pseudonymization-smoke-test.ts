import {
  ResearchPseudonymizationConfigError,
  researchPseudonymizationMetadata,
  researchStudentId
} from "../src/lib/services/teacher-research-data/pseudonymization";
import { buildAnalysisReadyDictionaryEntries } from "../src/lib/services/teacher-research-data/dictionary";
import { createSessionToken, verifySessionToken } from "../src/lib/auth";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function row(qualifiedName: string) {
  const entry = buildAnalysisReadyDictionaryEntries().find((candidate) => candidate.qualified_name === qualifiedName);
  assert(entry, `Missing ${qualifiedName}.`);
  return entry;
}

function main() {
  const envA: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "production",
    RESEARCH_PSEUDONYMIZATION_KEY: "phase31ah-test-key-a"
  };
  const envB: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "production",
    RESEARCH_PSEUDONYMIZATION_KEY: "phase31ah-test-key-b"
  };

  const idA1 = researchStudentId("Student_Demo", envA);
  const idA2 = researchStudentId("student_demo", envA);
  const idB = researchStudentId("student_demo", envB);
  assert(idA1 === idA2, "Canonical operational user identifier should be case-normalized.");
  assert(idA1 !== idB, "Changing the HMAC key should change research pseudonyms.");
  assert(idA1.startsWith("rs_"), "Pseudonym should keep the research-student prefix.");
  assert(!idA1.includes("student_demo"), "Pseudonym must not contain the operational identifier.");

  const metadata = researchPseudonymizationMetadata(envA);
  assert(metadata.research_pseudonym_version === "hmac_sha256_v1", "Production pseudonym version should be HMAC.");
  assert(metadata.pseudonymization_method === "HMAC-SHA-256", "Method should be HMAC-SHA-256.");
  assert(metadata.pseudonymization_key_fingerprint.length === 12, "Key fingerprint should be a short non-secret identifier.");
  assert(!metadata.pseudonymization_key_fingerprint.includes("phase31ah"), "Fingerprint must not reveal key text.");

  let missingKeyError: unknown = null;
  try {
    researchPseudonymizationMetadata({
      ...process.env,
      APP_ENV: "production",
      RESEARCH_PSEUDONYMIZATION_KEY: ""
    });
  } catch (error) {
    missingKeyError = error;
  }
  assert(missingKeyError instanceof ResearchPseudonymizationConfigError, "Production missing-key failure should be typed.");
  assert(
    (missingKeyError as ResearchPseudonymizationConfigError).code === "research_pseudonymization_key_missing",
    "Production missing-key failure should use the documented error code."
  );

  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousAppEnv = process.env.APP_ENV;
  const previousResearchKey = process.env.RESEARCH_PSEUDONYMIZATION_KEY;
  try {
    process.env.SESSION_SECRET = "phase31ah-auth-smoke-session-secret";
    process.env.APP_ENV = "production";
    process.env.RESEARCH_PSEUDONYMIZATION_KEY = "";
    const token = createSessionToken({
      user_db_id: "auth-smoke-db-id",
      user_id: "auth_smoke_teacher",
      role: "teacher_researcher",
      auth_version: 1
    });
    const claims = verifySessionToken(token);
    assert(claims?.user_id === "auth_smoke_teacher", "Authentication token verification should not require the research pseudonymization key.");
  } finally {
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
    if (previousAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = previousAppEnv;
    }
    if (previousResearchKey === undefined) {
      delete process.env.RESEARCH_PSEUDONYMIZATION_KEY;
    } else {
      process.env.RESEARCH_PSEUDONYMIZATION_KEY = previousResearchKey;
    }
  }

  const developmentMetadata = researchPseudonymizationMetadata({
    ...process.env,
    APP_ENV: "development",
    RESEARCH_PSEUDONYMIZATION_KEY: ""
  });
  assert(developmentMetadata.production_ready === false, "Development without a key should use the deterministic non-production test key.");

  const dictionaryRow = row("sessions.research_student_id");
  assert(dictionaryRow.collection_or_generation_method.includes("HMAC-SHA-256"), "Dictionary should document HMAC pseudonymization.");
  assert(dictionaryRow.interpretation_caution.includes("Pseudonymous, not anonymous"), "Dictionary should document pseudonymous-not-anonymous caution.");
  assert(row("sessions.pseudonymization_key_fingerprint").privacy_level === "export_provenance", "Fingerprint should be provenance, not a secret export.");
  assert(row("assessment_summary.research_pseudonym_version").allowed_values.includes("legacy_sha256_v1"), "Compatibility version should document legacy policy.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        pseudonym_prefix: idA1.slice(0, 5),
        key_fingerprint_prefix: metadata.pseudonymization_key_fingerprint.slice(0, 6),
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
