import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH
} from "../src/lib/operational/formative-conversation-v5-evaluation/contracts";
import {
  formativeConversationV5FixtureSources
} from "../src/lib/operational/formative-conversation-v5-evaluation/fixture-source";

function absolute(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

function readJson(relativePath: string) {
  return JSON.parse(
    readFileSync(absolute(relativePath), "utf8")
  ) as Record<string, unknown>;
}

function writeJson(relativePath: string, value: unknown) {
  const outputPath = absolute(relativePath);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

function fileSha(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

const fixtureReferences = formativeConversationV5FixtureSources.map(
  (source) => {
    const fixtureHash = stableHash(source);
    const fixture = { ...source, fixture_hash: fixtureHash };
    const fixturePath = `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixtures/${source.case_id}.json`;
    writeJson(fixturePath, fixture);
    return {
      case_id: source.case_id,
      order: source.case_order,
      path: fixturePath,
      fixture_hash: fixtureHash,
      file_sha256: fileSha(fixturePath)
    };
  }
);

const aggregateFixtureHash = stableHash(
  fixtureReferences.map((reference) => ({
    case_id: reference.case_id,
    case_order: reference.order,
    fixture_hash: reference.fixture_hash
  }))
);
const fixtureManifest = {
  manifest_version: "formative-conversation-v5-fixture-manifest-v1",
  fixture_hash_semantics:
    "stable_hash_of_fixture_with_fixture_hash_omitted",
  fixture_count: 8,
  fixed_case_order: fixtureReferences.map(
    (reference) => reference.case_id
  ),
  fixtures: fixtureReferences,
  aggregate_fixture_hash: aggregateFixtureHash,
  execution_engine:
    "formative-conversation-v5-protocol-runner-v1",
  forbidden_runner_substitutions: [
    "operational_model_upgrade_legacy_21_case_runner",
    "synthetic_student_persona_cli"
  ]
};
writeJson(FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH, fixtureManifest);

const protocol = readJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH);
const runnerImplementationFiles = [
  {
    role: "cli",
    path: "prisma/operational-formative-conversation-v5-evaluate.ts"
  },
  {
    role: "orchestration_service",
    path: "src/lib/operational/formative-conversation-v5-evaluation/service.ts"
  },
  {
    role: "candidate_transport_runner",
    path: "src/lib/operational/formative-conversation-v5-evaluation/candidate-runner.ts"
  },
  {
    role: "package_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation/package.ts"
  },
  {
    role: "contract_schemas",
    path: "src/lib/operational/formative-conversation-v5-evaluation/contracts.ts"
  }
].map((entry) => ({
  ...entry,
  sha256: fileSha(entry.path)
}));
const runnerImplementation = {
  aggregate_hash: stableHash(runnerImplementationFiles),
  files: runnerImplementationFiles
};
protocol.runner_implementation = runnerImplementation;
writeJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH, protocol);
const protocolHash = stableHash(protocol);
const approvalPlaceholder = readJson(
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH
);
approvalPlaceholder.evaluation_protocol_hash = protocolHash;
writeJson(
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH,
  approvalPlaceholder
);

const candidateManifest = readJson(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH
);
const sourceConfiguration = readJson(
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH
);
const candidateIdentity = readJson(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH
);
candidateIdentity.candidate_revision_manifest_hash =
  stableHash(candidateManifest);
candidateIdentity.candidate_revision_manifest_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_MANIFEST_PATH
);
candidateIdentity.executable_evaluation_protocol_hash = protocolHash;
candidateIdentity.executable_evaluation_protocol_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH
);
candidateIdentity.runner_implementation_hash =
  runnerImplementation.aggregate_hash;
candidateIdentity.fixture_manifest_hash = stableHash(fixtureManifest);
candidateIdentity.fixture_manifest_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
);
candidateIdentity.aggregate_fixture_hash = aggregateFixtureHash;
candidateIdentity.source_configuration_hash =
  stableHash(sourceConfiguration);
candidateIdentity.source_configuration_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH
);
candidateIdentity.approval_placeholder_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH
);
writeJson(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  candidateIdentity
);

console.log(
  JSON.stringify(
    {
      status: "materialized",
      provider_calls: 0,
      fixture_count: fixtureReferences.length,
      aggregate_fixture_hash: aggregateFixtureHash,
      evaluation_protocol_hash: protocolHash
    },
    null,
    2
  )
);
