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
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH,
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH,
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH,
  FormativeConversationV5FixtureSchema
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/contracts";
import {
  compileFormativeConversationV5ExecutionPlan
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/compiler";
import {
  formativeConversationV5FixtureSources
} from "../src/lib/operational/formative-conversation-v5-evaluation-v3/fixture-source";

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

const fixtureRecords = formativeConversationV5FixtureSources.map(
  (source) => {
    const fixtureHash = stableHash(source);
    const fixture = FormativeConversationV5FixtureSchema.parse({
      ...source,
      fixture_hash: fixtureHash
    });
    const fixturePath = `${FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT}/fixtures/${source.case_id}.json`;
    writeJson(fixturePath, fixture);
    return {
      fixture,
      reference: {
        case_id: source.case_id,
        order: source.case_order,
        path: fixturePath,
        fixture_hash: fixtureHash,
        file_sha256: fileSha(fixturePath)
      }
    };
  }
);

const aggregateFixtureHash = stableHash(
  fixtureRecords.map(({ reference }) => ({
    case_id: reference.case_id,
    case_order: reference.order,
    fixture_hash: reference.fixture_hash
  }))
);
const fixtureManifest = {
  manifest_version: "formative-conversation-v5-fixture-manifest-v2",
  fixture_hash_semantics:
    "stable_hash_of_fixture_with_fixture_hash_omitted",
  fixture_count: 8,
  fixed_case_order: fixtureRecords.map(
    ({ reference }) => reference.case_id
  ),
  fixtures: fixtureRecords.map(({ reference }) => reference),
  aggregate_fixture_hash: aggregateFixtureHash,
  execution_engine:
    "formative-conversation-v5-protocol-runner-v2",
  frozen_case_schema:
    "formative-conversation-v5-protocol-case-schema-v1",
  forbidden_runner_substitutions: [
    "operational_model_upgrade_legacy_21_case_runner",
    "synthetic_student_persona_cli",
    "synthetic_student_persona_schema"
  ]
};
writeJson(
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH,
  fixtureManifest
);

const protocol = readJson(FORMATIVE_CONVERSATION_V5_PROTOCOL_PATH);
const runnerImplementationFiles = [
  {
    role: "cli",
    path: "prisma/operational-formative-conversation-v5-v3-evaluate.ts"
  },
  {
    role: "orchestration_service",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v3/service.ts"
  },
  {
    role: "candidate_transport_runner",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v3/candidate-runner.ts"
  },
  {
    role: "package_validator",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v3/package.ts"
  },
  {
    role: "contract_schemas",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v3/contracts.ts"
  },
  {
    role: "case_compiler",
    path: "src/lib/operational/formative-conversation-v5-evaluation-v3/compiler.ts"
  },
  {
    role: "production_execution_harness",
    path: "src/lib/evaluation/synthetic-student-validation/framework.ts"
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
const fixtureManifestHash = stableHash(fixtureManifest);

const targetIdentity = protocol.target_identity as {
  runtime_candidate_hash: string;
};
const budget =
  protocol.budget as Parameters<
    typeof compileFormativeConversationV5ExecutionPlan
  >[0]["budget"];
const isolation = protocol.isolation as {
  run_namespace_template: string;
  case_namespace_template: string;
};
const intendedArtifacts = protocol.intended_artifacts as string[];
const compiledPlan = compileFormativeConversationV5ExecutionPlan({
  runtime_candidate_hash: targetIdentity.runtime_candidate_hash,
  evaluation_protocol_hash: protocolHash,
  runner_implementation_hash: runnerImplementation.aggregate_hash,
  fixture_manifest_hash: fixtureManifestHash,
  aggregate_fixture_hash: aggregateFixtureHash,
  fixtures: fixtureRecords.map(({ fixture }) => fixture),
  fixture_file_sha256_by_case: Object.fromEntries(
    fixtureRecords.map(({ reference }) => [
      reference.case_id,
      reference.file_sha256
    ])
  ),
  budget,
  run_namespace_template: isolation.run_namespace_template,
  case_namespace_template: isolation.case_namespace_template,
  intended_artifacts: intendedArtifacts
});
writeJson(FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH, compiledPlan);

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
candidateIdentity.fixture_manifest_hash = fixtureManifestHash;
candidateIdentity.fixture_manifest_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_FIXTURE_MANIFEST_PATH
);
candidateIdentity.aggregate_fixture_hash = aggregateFixtureHash;
candidateIdentity.compiled_execution_plan_hash =
  compiledPlan.compiled_plan_hash;
candidateIdentity.compiled_execution_plan_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_COMPILED_PLAN_PATH
);
candidateIdentity.source_configuration_hash =
  stableHash(sourceConfiguration);
candidateIdentity.source_configuration_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_SOURCE_CONFIGURATION_PATH
);
candidateIdentity.approval_placeholder_sha256 = fileSha(
  FORMATIVE_CONVERSATION_V5_APPROVAL_PLACEHOLDER_PATH
);
candidateIdentity.source_application_git_commit =
  sourceConfiguration.captured_from_application_git_commit;
writeJson(
  FORMATIVE_CONVERSATION_V5_CANDIDATE_IDENTITY_PATH,
  candidateIdentity
);

console.log(
  JSON.stringify(
    {
      status: "materialized",
      provider_calls: 0,
      fixture_count: fixtureRecords.length,
      aggregate_fixture_hash: aggregateFixtureHash,
      fixture_manifest_hash: fixtureManifestHash,
      evaluation_protocol_hash: protocolHash,
      runner_implementation_hash:
        runnerImplementation.aggregate_hash,
      compiled_plan_hash: compiledPlan.compiled_plan_hash
    },
    null,
    2
  )
);
