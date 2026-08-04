import { strict as assert } from "node:assert";
import {
  FORMATIVE_CONVERSATION_V15_COMMITTED_SOURCE_PATHS,
  verifyFormativeConversationV15CommittedSource
} from "../src/lib/operational/formative-conversation-v5-evaluation-v15/provenance";

const committedControl = verifyFormativeConversationV15CommittedSource({
  source_paths: ["docs/PRODUCT_SPEC.md"]
});
assert.match(
  committedControl.source_application_git_commit,
  /^[a-f0-9]{40}$/
);
assert.equal(committedControl.tracked_package_unchanged, true);
assert.ok(FORMATIVE_CONVERSATION_V15_COMMITTED_SOURCE_PATHS.length >= 8);

let uncommittedFreezeDetected = false;
try {
  verifyFormativeConversationV15CommittedSource();
} catch (error) {
  uncommittedFreezeDetected =
    error instanceof Error &&
    /formative_conversation_v15_(tracked_source_changed|tracked_package_missing)/.test(
      error.message
    );
}
assert.equal(
  uncommittedFreezeDetected,
  true,
  "The locally prepared V15 package must require a future committed-source freeze before dispatch."
);
console.log(
  JSON.stringify({
    status: "passed",
    provenance_algorithm_verified: true,
    uncommitted_live_dispatch_blocked: true,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  })
);
