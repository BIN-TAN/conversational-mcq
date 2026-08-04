import { strict as assert } from "node:assert";
import {
  assertFormativeConversationV15ScanCoverage,
  scanFormativeConversationV15BufferedOutputs
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/security-release";

const secret = "v15-deterministic-secret-value-123456789";
const safe = scanFormativeConversationV15BufferedOutputs({
  exact_secret_values: [secret],
  buffered_outputs: [
    JSON.stringify({
      status: "passed",
      secret_values_recorded: false,
      provider_calls: 0
    })
  ]
});
assert.equal(safe.exact_match_count, 0);
assert.equal(safe.generic_credential_pattern_match_count, 0);
assert.throws(
  () =>
    scanFormativeConversationV15BufferedOutputs({
      exact_secret_values: [secret],
      buffered_outputs: [`unsafe:${secret}`]
    }),
  /formative_conversation_v15_secret_match_detected/
);
assert.throws(
  () =>
    scanFormativeConversationV15BufferedOutputs({
      exact_secret_values: [secret],
      buffered_outputs: ["OPENAI_API_KEY=sk-unsafe-example-1234567890"]
    }),
  /formative_conversation_v15_secret_match_detected/
);
assert.doesNotThrow(() =>
  assertFormativeConversationV15ScanCoverage({
    expected_regular_file_count: 4,
    actual_regular_file_count: 4,
    expected_zip_file_count: 1,
    actual_zip_file_count: 1,
    expected_uncompressed_zip_entry_count: 3,
    actual_uncompressed_zip_entry_count: 3
  })
);
assert.throws(
  () =>
    assertFormativeConversationV15ScanCoverage({
      expected_regular_file_count: 4,
      actual_regular_file_count: 3,
      expected_zip_file_count: 1,
      actual_zip_file_count: 1,
      expected_uncompressed_zip_entry_count: 3,
      actual_uncompressed_zip_entry_count: 3
    }),
  /formative_conversation_v15_scan_coverage_mismatch/
);
console.log(
  JSON.stringify({
    status: "passed",
    exact_secret_scan: "passed",
    credential_pattern_scan: "passed",
    artifact_coverage_check: "passed",
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  })
);
