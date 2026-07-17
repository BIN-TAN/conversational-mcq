import assert from "node:assert/strict";
import {
  assertStudentPayloadPrivacy,
  assertStudentVisibleTextPrivacy,
  findStudentPayloadPrivacyFindings,
  findVisibleTextPrivacyFindings
} from "./student-formative-privacy-assertions";

const safePayload = {
  state: {
    assessment_state: "FORMATIVE_ACTIVITY",
    current_item: null,
    activity_runtime: {
      activity_attempt_public_id: "activity_public_fixture",
      first_turn_message: "Compare option B with the idea measured by this item."
    }
  }
};

assertStudentPayloadPrivacy(safePayload, "safe_payload");
assertStudentVisibleTextPrivacy(
  "Your explanation connects the item feature to the intended concept.",
  "safe_visible_text"
);

const nestedFieldLeak = findStudentPayloadPrivacyFindings({
  safe: { deeper: [{ agent_call_id: "hidden_agent_call" }] }
});
assert.equal(nestedFieldLeak.length, 1);
assert.equal(nestedFieldLeak[0]?.path, "payload.safe.deeper.0.agent_call_id");

const schemaLeak = findStudentPayloadPrivacyFindings({
  learning_profile: { profile_schema_version: "internal-v2" }
});
assert.equal(schemaLeak.length, 1);
assert.equal(schemaLeak[0]?.matched_label, "profile_schema_version");

const nestedTextLeak = findVisibleTextPrivacyFindings(
  "Debug detail: profile_update_failed after retry_count 2."
);
assert(nestedTextLeak.some((finding) => finding.matched_label === "fallback_or_failure_metadata"));

const nestedEnumLeak = findStudentPayloadPrivacyFindings({
  learning_profile: { confidence: { value: "overconfident" } }
});
assert.equal(nestedEnumLeak.length, 1);
assert.equal(nestedEnumLeak[0]?.path, "payload.learning_profile.confidence.value");

console.log(JSON.stringify({
  status: "passed",
  smoke: "student-formative-privacy",
  controlled_nested_field_leak_detected: true,
  controlled_internal_text_leak_detected: true,
  openai_calls: 0
}, null, 2));
