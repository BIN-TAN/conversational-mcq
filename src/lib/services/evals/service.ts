import { randomUUID } from "node:crypto";
import { stringify } from "csv-stringify/sync";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { agentInputSchemas, agentOutputSchemas } from "@/lib/agents/contracts";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { MockLlmProvider } from "@/lib/llm/providers/mock-provider";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import type { PublicUser } from "@/types/auth";
import { EvalServiceError } from "./errors";
import { loadEvalFixtureCases } from "./fixtures";
import { allRubricDefinitions, rubricDefinitionForAgent } from "./rubrics";
import {
  serializeEvalAnnotation,
  serializeEvalCase,
  serializeEvalRun,
  serializeEvalRunItem,
  serializeEvalSuite
} from "./serializers";
import {
  createEvalSuiteSchema,
  createMockEvalRunSchema,
  listEvalRunItemsQuerySchema,
  listEvalRunsQuerySchema,
  type UpsertEvalAnnotationInput,
  upsertEvalAnnotationSchema
} from "./types";
import {
  safetyValidateOutput,
  schemaValidateAgentOutput,
  semanticValidateAgentOutput
} from "./validation";

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function parseJsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function criticalFlagsFromRunItem(runItem: {
  safety_validation_result: unknown;
  annotations?: Array<{ safety_flags: unknown; pass_fail: string | null; overall_rating: number | null }>;
}) {
  const safety = parseJsonRecord(runItem.safety_validation_result);
  const flags = Array.isArray(safety.critical_failure_flags)
    ? safety.critical_failure_flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const annotationFlags =
    runItem.annotations?.flatMap((annotation) =>
      Array.isArray(annotation.safety_flags)
        ? annotation.safety_flags.filter((flag): flag is string => typeof flag === "string")
        : []
    ) ?? [];

  return [...new Set([...flags, ...annotationFlags])];
}

function autoCriticalFlagsFromRunItem(runItem: { safety_validation_result: unknown }) {
  const safety = parseJsonRecord(runItem.safety_validation_result);
  const flags = Array.isArray(safety.critical_failure_flags)
    ? safety.critical_failure_flags.filter((flag): flag is string => typeof flag === "string")
    : [];

  return [...new Set(flags)];
}

function humanCriticalFlagsFromAnnotations(annotations: Array<{ safety_flags: unknown }>) {
  return [
    ...new Set(
      annotations.flatMap((annotation) =>
        Array.isArray(annotation.safety_flags)
          ? annotation.safety_flags.filter((flag): flag is string => typeof flag === "string")
          : []
      )
    )
  ];
}

function semanticPass(runItem: { semantic_validation_result: unknown }) {
  return parseJsonRecord(runItem.semantic_validation_result).ok === true;
}

function safetyPass(runItem: { safety_validation_result: unknown }) {
  return parseJsonRecord(runItem.safety_validation_result).ok === true;
}

async function assertTeacherDbUser(user: PublicUser) {
  if (user.role !== "teacher_researcher") {
    throw new EvalServiceError("forbidden", "Teacher_researcher role is required.", 403);
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.user_db_id },
    select: { id: true, user_id: true, role: true }
  });

  if (!dbUser || dbUser.role !== "teacher_researcher") {
    throw new EvalServiceError("forbidden", "Teacher_researcher account was not found.", 403);
  }

  return dbUser;
}

export async function seedEvalFixtures(createdByUserDbId: string) {
  const fixtureGroups = await loadEvalFixtureCases();
  const seededSuites = [];

  for (const definition of allRubricDefinitions()) {
    const existing = await prisma.evalRubric.findFirst({
      where: {
        agent_name: definition.agent_name,
        rubric_version: definition.rubric_version
      }
    });

    if (existing) {
      await prisma.evalRubric.update({
        where: { id: existing.id },
        data: {
          schema_version: "phase7e1-eval-rubric-v1",
          criteria: prismaJson(definition)
        }
      });
    } else {
      await prisma.evalRubric.create({
        data: {
          rubric_public_id: generatePublicId("eval_rubric"),
          agent_name: definition.agent_name,
          rubric_version: definition.rubric_version,
          schema_version: "phase7e1-eval-rubric-v1",
          criteria: prismaJson(definition)
        }
      });
    }
  }

  for (const group of fixtureGroups) {
    const suite =
      (await prisma.evalSuite.findFirst({
        where: { agent_name: group.agent_name, title: group.suite_title }
      })) ??
      (await prisma.evalSuite.create({
        data: {
          suite_public_id: generatePublicId("eval_suite"),
          title: group.suite_title,
          description: group.suite_description,
          agent_name: group.agent_name,
          status: "active",
          created_by_user_db_id: createdByUserDbId
        }
      }));

    await prisma.evalSuite.update({
      where: { id: suite.id },
      data: {
        description: group.suite_description,
        status: "active"
      }
    });

    for (const evalCase of group.cases) {
      const existing = await prisma.evalCase.findFirst({
        where: {
          suite_db_id: suite.id,
          case_id: evalCase.case_id
        }
      });

      const caseData = {
        title: evalCase.title,
        description: evalCase.description,
        agent_name: evalCase.agent_name,
        input_payload: prismaJson(evalCase.input_payload),
        expected_output: prismaJson(evalCase.expected_output_shape ?? {}),
        gold_labels: prismaJson(evalCase.gold_labels ?? {}),
        rubric_expectations: prismaJson(evalCase.rubric_expectations ?? {}),
        safety_expectations: prismaJson(evalCase.safety_expectations ?? {}),
        case_source: "synthetic" as const,
        status: "active" as const
      };

      if (existing) {
        await prisma.evalCase.update({
          where: { id: existing.id },
          data: caseData
        });
      } else {
        await prisma.evalCase.create({
          data: {
            case_public_id: generatePublicId("eval_case"),
            suite_db_id: suite.id,
            case_id: evalCase.case_id,
            ...caseData
          }
        });
      }
    }

    seededSuites.push(suite.suite_public_id);
  }

  return {
    suite_public_ids: seededSuites,
    suite_count: seededSuites.length,
    case_count: fixtureGroups.reduce((total, group) => total + group.cases.length, 0)
  };
}

export async function cleanupEvalFixtures() {
  const suites = await prisma.evalSuite.findMany({
    where: { title: { startsWith: "Phase 7E1 synthetic" } },
    select: { id: true }
  });
  const suiteIds = suites.map((suite) => suite.id);

  if (suiteIds.length === 0) {
    return { removed_suites: 0, removed_cases: 0, removed_runs: 0 };
  }

  const runIds = (
    await prisma.evalRun.findMany({
      where: { suite_db_id: { in: suiteIds } },
      select: { id: true }
    })
  ).map((run) => run.id);
  const runItemIds = (
    await prisma.evalRunItem.findMany({
      where: { run_db_id: { in: runIds } },
      select: { id: true }
    })
  ).map((runItem) => runItem.id);

  await prisma.evalAnnotation.deleteMany({
    where: { run_item_db_id: { in: runItemIds } }
  });
  await prisma.evalRunItem.deleteMany({
    where: { run_db_id: { in: runIds } }
  });
  const removedRuns = await prisma.evalRun.deleteMany({
    where: { id: { in: runIds } }
  });
  const removedCases = await prisma.evalCase.deleteMany({
    where: {
      suite_db_id: { in: suiteIds },
      case_source: "synthetic",
      run_items: { none: {} }
    }
  });
  const removedSuites = await prisma.evalSuite.deleteMany({
    where: {
      id: { in: suiteIds },
      cases: { none: {} },
      runs: { none: {} }
    }
  });

  await prisma.evalRubric.deleteMany({
    where: { rubric_version: "phase7e1-v1" }
  });

  return {
    removed_suites: removedSuites.count,
    removed_cases: removedCases.count,
    removed_runs: removedRuns.count
  };
}

export async function listEvalSuites() {
  const suites = await prisma.evalSuite.findMany({
    orderBy: [{ agent_name: "asc" }, { title: "asc" }],
    include: {
      _count: { select: { cases: true, runs: true } }
    }
  });

  return { suites: suites.map(serializeEvalSuite) };
}

export async function createEvalSuite(input: unknown, user: PublicUser) {
  const teacher = await assertTeacherDbUser(user);
  const parsed = createEvalSuiteSchema.parse(input);

  const suite = await prisma.evalSuite.create({
    data: {
      suite_public_id: generatePublicId("eval_suite"),
      title: parsed.title,
      description: parsed.description ?? null,
      agent_name: parsed.agent_name,
      status: "active",
      created_by_user_db_id: teacher.id
    },
    include: { _count: { select: { cases: true, runs: true } } }
  });

  return { suite: serializeEvalSuite(suite) };
}

export async function getEvalSuite(suitePublicId: string) {
  const suite = await prisma.evalSuite.findUnique({
    where: { suite_public_id: suitePublicId },
    include: {
      cases: { orderBy: { case_id: "asc" } },
      _count: { select: { cases: true, runs: true } }
    }
  });

  if (!suite) {
    throw new EvalServiceError("suite_not_found", "Evaluation suite was not found.", 404);
  }

  return {
    suite: serializeEvalSuite(suite),
    cases: suite.cases.map(serializeEvalCase),
    rubric: rubricDefinitionForAgent(suite.agent_name as AgentNameType)
  };
}

async function suitesForMockRun(input: {
  suite_public_id?: string;
  agent_name?: AgentNameType;
}) {
  const where = input.suite_public_id
    ? { suite_public_id: input.suite_public_id }
    : input.agent_name
      ? { agent_name: input.agent_name, status: "active" as const }
      : { status: "active" as const, title: { startsWith: "Phase 7E1 synthetic" } };
  const suites = await prisma.evalSuite.findMany({
    where,
    include: {
      cases: {
        where: { status: "active" },
        orderBy: { case_id: "asc" }
      }
    },
    orderBy: [{ agent_name: "asc" }, { title: "asc" }]
  });

  if (suites.length === 0) {
    throw new EvalServiceError(
      "suite_not_found",
      "No active evaluation suite matched the requested mock run.",
      404
    );
  }

  return suites;
}

async function createOneMockRun(input: {
  suite: Awaited<ReturnType<typeof suitesForMockRun>>[number];
  userDbId: string;
  repetitionCount: number;
}) {
  const env = getServerEnv();
  const provider = new MockLlmProvider();
  const agentName = input.suite.agent_name as AgentNameType;
  const prompt = getPromptForAgent(agentName);
  const modelConfig = {
    model_name: env.EVAL_TARGET_MODEL,
    repetitions: input.repetitionCount,
    live_calls_enabled: false,
    cost_hard_limit_usd: env.EVAL_COST_HARD_LIMIT_USD,
    eval_target_model: env.EVAL_TARGET_MODEL,
    mock_provider: true
  };

  const run = await prisma.evalRun.create({
    data: {
      run_public_id: generatePublicId("eval_run"),
      suite_db_id: input.suite.id,
      agent_name: agentName,
      provider: "mock",
      model_name: env.EVAL_TARGET_MODEL,
      model_config: prismaJson(modelConfig),
      prompt_version: prompt.prompt_version,
      schema_version: prompt.schema_version,
      prompt_hash: prompt.prompt_hash,
      run_mode: "mock",
      repetition_count: input.repetitionCount,
      status: "running",
      created_by_user_db_id: input.userDbId,
      started_at: new Date()
    }
  });

  try {
    for (const evalCase of input.suite.cases) {
      for (let repetitionIndex = 1; repetitionIndex <= input.repetitionCount; repetitionIndex += 1) {
        const startedAt = Date.now();
        const goldLabels = parseJsonRecord(evalCase.gold_labels);
        const mockMode =
          typeof goldLabels.mock_mode === "string" ? goldLabels.mock_mode : "success";
        const parsedInput = agentInputSchemas[agentName].safeParse(evalCase.input_payload);

        if (!parsedInput.success) {
          const schemaError = parsedInput.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ");
          const safety = safetyValidateOutput({
            agentName,
            output: null,
            schemaValid: false,
            semanticValid: false
          });

          await prisma.evalRunItem.create({
            data: {
              run_item_public_id: generatePublicId("eval_run_item"),
              run_db_id: run.id,
              case_db_id: evalCase.id,
              repetition_index: repetitionIndex,
              input_payload: prismaJson(evalCase.input_payload),
              raw_output: Prisma.JsonNull,
              parsed_output: Prisma.JsonNull,
              output_validated: false,
              schema_validation_error: `Input validation failed: ${schemaError}`,
              semantic_validation_result: prismaJson({
                ok: false,
                issues: ["Provider input failed contract validation."],
                warnings: []
              }),
              safety_validation_result: prismaJson(safety),
              execution_status: "input_invalid",
              latency_ms: Date.now() - startedAt,
              token_usage: Prisma.JsonNull
            }
          });

          continue;
        }

        const result = await provider.executeStructured({
          agent_name: agentName,
          model_config: { model_name: env.EVAL_TARGET_MODEL },
          instructions: prompt.instructions,
          input: parsedInput.data,
          output_schema: agentOutputSchemas[agentName] as z.ZodType<unknown>,
          schema_name: prompt.schema_version,
          client_request_id: `eval_${run.run_public_id}_${evalCase.case_id}_${repetitionIndex}_${randomUUID()}`,
          timeout_ms: 30000,
          metadata: {
            mock_mode: mockMode,
            evaluation_run: "phase7e1"
          }
        });
        const schema = schemaValidateAgentOutput({
          agentName,
          output: result.parsed_output
        });
        const semantic =
          schema.output_validated
            ? semanticValidateAgentOutput({
                agentName,
                providerInput: parsedInput.data,
                output: schema.parsed_output
              })
            : { ok: false, issues: ["Schema validation failed."], warnings: [] };
        const safety = safetyValidateOutput({
          agentName,
          output: schema.parsed_output,
          schemaValid: schema.output_validated,
          semanticValid: semantic.ok
        });

        await prisma.evalRunItem.create({
          data: {
            run_item_public_id: generatePublicId("eval_run_item"),
            run_db_id: run.id,
            case_db_id: evalCase.id,
            repetition_index: repetitionIndex,
            input_payload: prismaJson(parsedInput.data),
            raw_output: prismaJson(result.raw_output ?? null),
            parsed_output: prismaJson(schema.parsed_output ?? null),
            output_validated: schema.output_validated,
            schema_validation_error: schema.schema_validation_error,
            semantic_validation_result: prismaJson(semantic),
            safety_validation_result: prismaJson(safety),
            execution_status: result.status,
            latency_ms: result.latency_ms,
            token_usage: prismaJson(result.usage ?? null)
          }
        });
      }
    }

    const completed = await prisma.evalRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completed_at: new Date()
      },
      include: {
        suite: { select: { suite_public_id: true, title: true } },
        _count: { select: { run_items: true } }
      }
    });

    return serializeEvalRun(completed);
  } catch (error) {
    const failed = await prisma.evalRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completed_at: new Date()
      },
      include: {
        suite: { select: { suite_public_id: true, title: true } },
        _count: { select: { run_items: true } }
      }
    });

    console.error(error);

    return serializeEvalRun(failed);
  }
}

export async function createMockEvaluationRuns(input: unknown, user: PublicUser) {
  const teacher = await assertTeacherDbUser(user);
  const parsed = createMockEvalRunSchema.parse(input ?? {});

  const suites = await suitesForMockRun(parsed);
  const repetitionCount = parsed.repetition_count ?? getServerEnv().EVAL_DEFAULT_REPETITIONS;
  const runs = [];

  for (const suite of suites) {
    runs.push(await createOneMockRun({
      suite,
      userDbId: teacher.id,
      repetitionCount
    }));
  }

  return {
    run_mode: "mock",
    runs,
    run_count: runs.length,
    live_provider_rejected: true
  };
}

export async function rejectLiveEvaluation() {
  throw new EvalServiceError(
    "live_provider_not_implemented",
    "Live provider evaluation is not implemented in Phase 7E1.",
    501
  );
}

export async function listEvalRuns(input: unknown) {
  const parsed = listEvalRunsQuerySchema.parse(input);
  const where = {
    ...(parsed.agent_name ? { agent_name: parsed.agent_name } : {}),
    ...(parsed.run_mode ? { run_mode: parsed.run_mode } : {}),
    ...(parsed.status ? { status: parsed.status } : {})
  };
  const [total, runs] = await Promise.all([
    prisma.evalRun.count({ where }),
    prisma.evalRun.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (parsed.page - 1) * parsed.page_size,
      take: parsed.page_size,
      include: {
        suite: { select: { suite_public_id: true, title: true } },
        _count: { select: { run_items: true } }
      }
    })
  ]);

  return {
    runs: runs.map(serializeEvalRun),
    pagination: {
      page: parsed.page,
      page_size: parsed.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / parsed.page_size))
    }
  };
}

export async function getEvalRun(runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: {
      suite: { select: { suite_public_id: true, title: true } },
      _count: { select: { run_items: true } }
    }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Evaluation run was not found.", 404);
  }

  return {
    run: serializeEvalRun(run),
    summary: await summarizeEvalRun(runPublicId)
  };
}

export async function listEvalRunItems(runPublicId: string, input: unknown = {}) {
  const parsed = listEvalRunItemsQuerySchema.parse(input);
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    select: { id: true }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Evaluation run was not found.", 404);
  }

  const allItems = await prisma.evalRunItem.findMany({
    where: {
      run_db_id: run.id,
      ...(parsed.execution_status ? { execution_status: parsed.execution_status } : {})
    },
    orderBy: [{ run_order: "asc" }, { created_at: "asc" }, { repetition_index: "asc" }],
    include: {
      eval_case: true,
      run: {
        include: {
          suite: { select: { suite_public_id: true, title: true } }
        }
      },
      annotations: {
        include: {
          annotated_by: { select: { user_id: true, display_name: true } }
        }
      }
    }
  });
  const filtered = allItems.filter((item) => {
    if (parsed.failures_only) {
      const hasFailure =
        !item.output_validated ||
        !semanticPass(item) ||
        !safetyPass(item) ||
        criticalFlagsFromRunItem(item).length > 0;

      if (!hasFailure) {
        return false;
      }
    }

    if (parsed.critical_failure) {
      return criticalFlagsFromRunItem(item).includes(parsed.critical_failure);
    }

    return true;
  });
  const start = (parsed.page - 1) * parsed.page_size;
  const pageItems = filtered.slice(start, start + parsed.page_size);

  return {
    items: pageItems.map((item) => serializeEvalRunItem(item)),
    pagination: {
      page: parsed.page,
      page_size: parsed.page_size,
      total: filtered.length,
      total_pages: Math.max(1, Math.ceil(filtered.length / parsed.page_size))
    }
  };
}

export async function getEvalRunItem(runItemPublicId: string, options: { blind?: boolean } = {}) {
  const item = await prisma.evalRunItem.findUnique({
    where: { run_item_public_id: runItemPublicId },
    include: {
      eval_case: true,
      run: {
        include: {
          suite: { select: { suite_public_id: true, title: true } }
        }
      },
      annotations: {
        include: {
          annotated_by: { select: { user_id: true, display_name: true } }
        }
      }
    }
  });

  if (!item) {
    throw new EvalServiceError("run_item_not_found", "Evaluation run item was not found.", 404);
  }

  return {
    item: serializeEvalRunItem(item, options)
  };
}

export async function upsertEvalAnnotation(
  runItemPublicId: string,
  input: unknown,
  user: PublicUser
) {
  const teacher = await assertTeacherDbUser(user);
  const parsed: UpsertEvalAnnotationInput = upsertEvalAnnotationSchema.parse(input);
  const runItem = await prisma.evalRunItem.findUnique({
    where: { run_item_public_id: runItemPublicId },
    select: { id: true }
  });

  if (!runItem) {
    throw new EvalServiceError("run_item_not_found", "Evaluation run item was not found.", 404);
  }

  const annotation = await prisma.evalAnnotation.upsert({
    where: {
      run_item_db_id_annotated_by_user_db_id: {
        run_item_db_id: runItem.id,
        annotated_by_user_db_id: teacher.id
      }
    },
    create: {
      annotation_public_id: generatePublicId("eval_annotation"),
      run_item_db_id: runItem.id,
      annotated_by_user_db_id: teacher.id,
      blind_review: parsed.blind_review,
      overall_rating: parsed.overall_rating ?? null,
      pass_fail: parsed.pass_fail ?? null,
      rubric_scores: prismaJson(parsed.rubric_scores ?? {}),
      safety_flags: prismaJson(parsed.safety_flags ?? []),
      notes: parsed.notes ?? null
    },
    update: {
      blind_review: parsed.blind_review,
      overall_rating: parsed.overall_rating ?? null,
      pass_fail: parsed.pass_fail ?? null,
      rubric_scores: prismaJson(parsed.rubric_scores ?? {}),
      safety_flags: prismaJson(parsed.safety_flags ?? []),
      notes: parsed.notes ?? null
    },
    include: {
      annotated_by: { select: { user_id: true, display_name: true } }
    }
  });

  return { annotation: serializeEvalAnnotation(annotation) };
}

async function evalRunItemsForSummary(runPublicId?: string) {
  return prisma.evalRunItem.findMany({
    where: runPublicId
      ? {
          run: { run_public_id: runPublicId }
        }
      : {},
    include: {
      eval_case: { select: { agent_name: true } },
      annotations: true
    }
  });
}

export async function summarizeEvalRun(runPublicId?: string) {
  const items = await evalRunItemsForSummary(runPublicId);
  const caseCount = new Set(items.map((item) => item.case_db_id)).size;
  const completedCount = items.filter((item) => item.execution_status === "completed").length;
  const schemaPassCount = items.filter((item) => item.output_validated).length;
  const semanticPassCount = items.filter(semanticPass).length;
  const safetyPassCount = items.filter(safetyPass).length;
  const annotations = items.flatMap((item) => item.annotations);
  const annotationPassCount = annotations.filter((annotation) => annotation.pass_fail === "pass").length;
  const criticalFlags = items.flatMap(criticalFlagsFromRunItem);
  const ratings = annotations
    .map((annotation) => annotation.overall_rating)
    .filter((rating): rating is number => typeof rating === "number");
  const failuresByAgent: Record<string, number> = {};
  const failuresByCriticalFlag: Record<string, number> = {};
  const rubricTotalsByAgent: Record<string, Record<string, { total: number; count: number }>> = {};

  for (const item of items) {
    const failed =
      !item.output_validated ||
      !semanticPass(item) ||
      !safetyPass(item) ||
      criticalFlagsFromRunItem(item).length > 0 ||
      item.annotations.some((annotation) => annotation.pass_fail === "fail");

    if (failed) {
      const agentName = item.eval_case.agent_name;
      failuresByAgent[agentName] = (failuresByAgent[agentName] ?? 0) + 1;
    }

    for (const flag of criticalFlagsFromRunItem(item)) {
      failuresByCriticalFlag[flag] = (failuresByCriticalFlag[flag] ?? 0) + 1;
    }

    for (const annotation of item.annotations) {
      const agentName = item.eval_case.agent_name;
      const scores = parseJsonRecord(annotation.rubric_scores);
      rubricTotalsByAgent[agentName] ??= {};

      for (const [criterion, value] of Object.entries(scores)) {
        if (typeof value === "number") {
          rubricTotalsByAgent[agentName][criterion] ??= { total: 0, count: 0 };
          rubricTotalsByAgent[agentName][criterion].total += value;
          rubricTotalsByAgent[agentName][criterion].count += 1;
        }
      }
    }
  }

  const meanRubricScoresByAgent = Object.fromEntries(
    Object.entries(rubricTotalsByAgent).map(([agentName, criteria]) => [
      agentName,
      Object.fromEntries(
        Object.entries(criteria).map(([criterion, value]) => [
          criterion,
          value.count === 0 ? null : value.total / value.count
        ])
      )
    ])
  );

  return {
    label: "development evaluation",
    classroom_validation: false,
    case_count: caseCount,
    completed_count: completedCount,
    schema_pass_rate: items.length === 0 ? null : schemaPassCount / items.length,
    semantic_pass_rate: items.length === 0 ? null : semanticPassCount / items.length,
    safety_pass_rate: items.length === 0 ? null : safetyPassCount / items.length,
    annotation_pass_rate: annotations.length === 0 ? null : annotationPassCount / annotations.length,
    critical_failure_count: criticalFlags.length,
    mean_overall_rating:
      ratings.length === 0 ? null : ratings.reduce((total, rating) => total + rating, 0) / ratings.length,
    mean_rubric_scores_by_agent: meanRubricScoresByAgent,
    failures_by_agent: failuresByAgent,
    failures_by_critical_flag: failuresByCriticalFlag
  };
}

export async function exportEvalRunCsv(runPublicId: string) {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    include: { suite: true }
  });

  if (!run) {
    throw new EvalServiceError("run_not_found", "Evaluation run was not found.", 404);
  }

  const items = await prisma.evalRunItem.findMany({
    where: { run_db_id: run.id },
    orderBy: [{ run_order: "asc" }, { created_at: "asc" }, { repetition_index: "asc" }],
    include: {
      eval_case: true,
      annotations: true
    }
  });
  const rows = items.map((item) => {
    const semantic = parseJsonRecord(item.semantic_validation_result);
    const safety = parseJsonRecord(item.safety_validation_result);
    const firstAnnotation = item.annotations[0];

    return {
      run_public_id: run.run_public_id,
      suite_public_id: run.suite.suite_public_id,
      case_id: item.eval_case.case_id,
      agent_name: item.eval_case.agent_name,
      run_mode: run.run_mode,
      provider: run.provider,
      model_name: run.model_name,
      model_snapshot: item.model_snapshot ?? run.model_snapshot ?? run.model_name,
      reasoning_effort: item.reasoning_effort ?? run.reasoning_effort ?? "",
      max_output_tokens: item.max_output_tokens ?? "",
      provider_response_id: item.provider_response_id ?? "",
      provider_request_id: item.provider_request_id ?? "",
      retry_count: item.retry_count ?? 0,
      input_tokens: item.input_tokens ?? "",
      cached_input_tokens: item.cached_input_tokens ?? "",
      output_tokens: item.output_tokens ?? "",
      reasoning_tokens: item.reasoning_tokens ?? "",
      total_tokens: item.total_tokens ?? "",
      estimated_cost_usd: item.estimated_cost_usd === null ? "" : String(item.estimated_cost_usd),
      prompt_version: run.prompt_version,
      schema_version: run.schema_version,
      prompt_hash: run.prompt_hash,
      output_validated: item.output_validated,
      semantic_pass: semantic.ok === true,
      safety_pass: safety.ok === true,
      critical_failure_flags: criticalFlagsFromRunItem(item).join("|"),
      auto_critical_failure_flags: autoCriticalFlagsFromRunItem(item).join("|"),
      human_critical_failure_flags: humanCriticalFlagsFromAnnotations(item.annotations).join("|"),
      canary_gate_status: run.canary_gate_status ?? "",
      case_manifest_hash: run.case_manifest_hash ?? "",
      run_config_hash: run.run_config_hash ?? "",
      git_commit:
        run.reproducibility_manifest &&
        typeof run.reproducibility_manifest === "object" &&
        !Array.isArray(run.reproducibility_manifest)
          ? String((run.reproducibility_manifest as { application_git_commit?: unknown }).application_git_commit ?? "")
          : "",
      annotation_pass_fail: firstAnnotation?.pass_fail ?? "",
      overall_rating: firstAnnotation?.overall_rating ?? "",
      rubric_scores_json: firstAnnotation?.rubric_scores ? stableJson(firstAnnotation.rubric_scores) : "{}",
      notes: firstAnnotation?.notes ?? ""
    };
  });

  const csv = stringify(rows, {
    header: true,
    columns: [
      "run_public_id",
      "suite_public_id",
      "case_id",
      "agent_name",
      "run_mode",
      "provider",
      "model_name",
      "model_snapshot",
      "reasoning_effort",
      "max_output_tokens",
      "provider_response_id",
      "provider_request_id",
      "retry_count",
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_tokens",
      "total_tokens",
      "estimated_cost_usd",
      "prompt_version",
      "schema_version",
      "prompt_hash",
      "output_validated",
      "semantic_pass",
      "safety_pass",
      "critical_failure_flags",
      "auto_critical_failure_flags",
      "human_critical_failure_flags",
      "canary_gate_status",
      "case_manifest_hash",
      "run_config_hash",
      "git_commit",
      "annotation_pass_fail",
      "overall_rating",
      "rubric_scores_json",
      "notes"
    ]
  });

  return {
    file_name: `eval_results_${run.run_public_id}.csv`,
    csv,
    row_count: rows.length
  };
}
