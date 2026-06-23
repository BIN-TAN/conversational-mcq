import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { agentOutputSchemas } from "@/lib/agents/contracts";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { agentNames } from "@/lib/agents/names";
import { getPromptForAgent } from "@/lib/agents/prompts/registry";

type JsonSchemaObject = {
  type?: unknown;
  anyOf?: unknown;
  oneOf?: unknown;
  allOf?: unknown;
  properties?: Record<string, unknown>;
  required?: unknown;
  additionalProperties?: unknown;
  items?: unknown;
  definitions?: Record<string, unknown>;
  $defs?: Record<string, unknown>;
  nullable?: unknown;
};

export type StructuredOutputCompatibilityIssue = {
  code: string;
  path: string;
  message: string;
};

export type StructuredOutputCompatibilityResult = {
  agent_name: AgentNameType | string;
  prompt_version: string;
  schema_version: string;
  prompt_hash: string;
  compatible: boolean;
  schema_compiled: boolean;
  issues: StructuredOutputCompatibilityIssue[];
  json_schema?: unknown;
};

function asObject(value: unknown): JsonSchemaObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonSchemaObject)
    : null;
}

function issue(code: string, path: string, message: string): StructuredOutputCompatibilityIssue {
  return { code, path, message };
}

function schemaTypeAllowsObject(schema: JsonSchemaObject) {
  if (schema.type === "object") {
    return true;
  }

  return Array.isArray(schema.type) && schema.type.includes("object");
}

export function validateStructuredOutputJsonSchema(input: {
  schema: unknown;
  rootName: string;
}): StructuredOutputCompatibilityIssue[] {
  const issues: StructuredOutputCompatibilityIssue[] = [];
  const root = asObject(input.schema);

  if (!root) {
    return [
      issue("schema_not_object", "#", `${input.rootName} did not compile to a JSON schema object.`)
    ];
  }

  if ("anyOf" in root || "oneOf" in root || "allOf" in root) {
    issues.push(
      issue(
        "root_union_not_supported",
        "#",
        `${input.rootName} must compile to a root object, not a root union/composition.`
      )
    );
  }

  if (!schemaTypeAllowsObject(root)) {
    issues.push(
      issue("root_not_object", "#", `${input.rootName} must compile to a root object schema.`)
    );
  }

  walkJsonSchema(root, "#", issues);

  return issues;
}

function walkJsonSchema(
  schema: JsonSchemaObject,
  path: string,
  issues: StructuredOutputCompatibilityIssue[]
) {
  if (Object.keys(schema).length === 0) {
    issues.push(
      issue(
        "untyped_schema_not_supported",
        path,
        "Open z.any/z.unknown output fields are not accepted at provider-facing output boundaries."
      )
    );
    return;
  }

  if (schema.anyOf && path === "#") {
    issues.push(issue("root_anyof_not_supported", path, "Root anyOf is not supported."));
  }

  const hasProperties = schema.properties && typeof schema.properties === "object";
  const isObjectSchema = schemaTypeAllowsObject(schema) || hasProperties;

  if (isObjectSchema) {
    if (schema.additionalProperties !== false) {
      issues.push(
        issue(
          "additional_properties_not_false",
          path,
          "Structured Outputs object schemas must use additionalProperties=false."
        )
      );
    }

    if (!hasProperties) {
      issues.push(issue("object_without_properties", path, "Object schema has no properties."));
    } else {
      const propertyNames = Object.keys(schema.properties ?? {});
      const required = Array.isArray(schema.required)
        ? schema.required.filter((entry): entry is string => typeof entry === "string")
        : [];

      for (const propertyName of propertyNames) {
        if (!required.includes(propertyName)) {
          issues.push(
            issue(
              "property_not_required",
              `${path}/properties/${propertyName}`,
              "OpenAI Structured Outputs requires every object property to be required; use nullable for logical optionality."
            )
          );
        }
      }

      for (const [propertyName, propertySchema] of Object.entries(schema.properties ?? {})) {
        const propertyObject = asObject(propertySchema);

        if (propertyObject) {
          walkJsonSchema(propertyObject, `${path}/properties/${propertyName}`, issues);
        }
      }
    }
  }

  if (schema.additionalProperties && schema.additionalProperties !== false) {
    issues.push(
      issue(
        "open_additional_properties",
        path,
        "Open maps/dictionaries are not accepted at provider-facing output boundaries."
      )
    );
  }

  const items = asObject(schema.items);
  if (items) {
    walkJsonSchema(items, `${path}/items`, issues);
  }

  for (const [definitionName, definitionSchema] of Object.entries(schema.definitions ?? {})) {
    const definitionObject = asObject(definitionSchema);

    if (definitionObject) {
      walkJsonSchema(definitionObject, `${path}/definitions/${definitionName}`, issues);
    }
  }

  for (const [definitionName, definitionSchema] of Object.entries(schema.$defs ?? {})) {
    const definitionObject = asObject(definitionSchema);

    if (definitionObject) {
      walkJsonSchema(definitionObject, `${path}/$defs/${definitionName}`, issues);
    }
  }
}

function compileSchema(schema: z.ZodType<unknown>, schemaName: string) {
  const format = zodTextFormat(schema, schemaName);
  return format.schema;
}

export function checkStructuredOutputCompatibilityForAgent(
  agentName: AgentNameType
): StructuredOutputCompatibilityResult {
  const prompt = getPromptForAgent(agentName);

  try {
    const jsonSchema = compileSchema(
      agentOutputSchemas[agentName] as z.ZodType<unknown>,
      prompt.schema_version
    );
    const issues = validateStructuredOutputJsonSchema({
      schema: jsonSchema,
      rootName: prompt.schema_version
    });

    return {
      agent_name: agentName,
      prompt_version: prompt.prompt_version,
      schema_version: prompt.schema_version,
      prompt_hash: prompt.prompt_hash,
      compatible: issues.length === 0,
      schema_compiled: true,
      issues,
      json_schema: jsonSchema
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Structured Outputs schema error.";

    return {
      agent_name: agentName,
      prompt_version: prompt.prompt_version,
      schema_version: prompt.schema_version,
      prompt_hash: prompt.prompt_hash,
      compatible: false,
      schema_compiled: false,
      issues: [
        issue(
          "structured_output_schema_incompatible",
          "#",
          message
        )
      ]
    };
  }
}

export function checkAllStructuredOutputCompatibility() {
  return agentNames.map((agentName) => checkStructuredOutputCompatibilityForAgent(agentName));
}

export function checkCustomStructuredOutputCompatibility(input: {
  schema: z.ZodType<unknown>;
  schema_name: string;
}) {
  try {
    const jsonSchema = compileSchema(input.schema, input.schema_name);
    const issues = validateStructuredOutputJsonSchema({
      schema: jsonSchema,
      rootName: input.schema_name
    });

    return {
      compatible: issues.length === 0,
      schema_compiled: true,
      issues,
      json_schema: jsonSchema
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Structured Outputs schema error.";

    return {
      compatible: false,
      schema_compiled: false,
      issues: [issue("structured_output_schema_incompatible", "#", message)]
    };
  }
}

export function structuredOutputCompatibilitySummary() {
  const results = checkAllStructuredOutputCompatibility();

  return {
    ok: results.every((result) => result.compatible),
    results
  };
}
