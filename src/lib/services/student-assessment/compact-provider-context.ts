import { stableHash } from "@/lib/operational/stable-hash";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

export function compactRepeatedDiagnosticContext<T extends {
  included_items: RecordValue[]; item_responses: RecordValue[];
}>(value: T): T {
  const items = new Map(value.included_items.map((item) => [item.item_public_id, item]));
  return {
    ...value,
    item_responses: value.item_responses.map((response) => {
      const item = items.get(response.item_public_id);
      const guidance = record(response.teacher_diagnostic_context);
      if (!item || Object.keys(guidance).length === 0 ||
          stableHash(guidance) !== stableHash(item.teacher_diagnostic_context)) return response;
      const { teacher_diagnostic_context: _duplicate, ...evidence } = response;
      void _duplicate;
      return { ...evidence, teacher_diagnostic_context_ref: {
        collection: "response_package.included_items", item_public_id: response.item_public_id
      } };
    })
  };
}
