import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentName as AgentNameType } from "@/lib/agents/names";
import { evalCaseFixtureSchema, type EvalCaseFixture } from "./types";

const fixtureFiles: Array<{
  agent_name: AgentNameType;
  file_name: string;
  suite_title: string;
  suite_description: string;
}> = [
  {
    agent_name: "item_verification_agent",
    file_name: "item-verification-cases.json",
    suite_title: "Phase 7E1 synthetic item verification cases",
    suite_description:
      "Synthetic development-evaluation cases for the Item Verification Agent."
  },
  {
    agent_name: "response_collection_agent",
    file_name: "response-collection-cases.json",
    suite_title: "Phase 7E1 synthetic response collection cases",
    suite_description:
      "Synthetic development-evaluation cases for the Response Collection Agent."
  },
  {
    agent_name: "student_profiling_agent",
    file_name: "student-profiling-cases.json",
    suite_title: "Phase 7E1 synthetic student profiling cases",
    suite_description:
      "Synthetic development-evaluation cases for the Student Profiling Agent."
  },
  {
    agent_name: "formative_value_and_planning_agent",
    file_name: "formative-planning-cases.json",
    suite_title: "Phase 7E1 synthetic formative planning cases",
    suite_description:
      "Synthetic development-evaluation cases for the Formative Value and Planning Agent."
  },
  {
    agent_name: "followup_agent",
    file_name: "followup-cases.json",
    suite_title: "Phase 7E1 synthetic follow-up cases",
    suite_description:
      "Synthetic development-evaluation cases for the Follow-up Agent."
  }
];

export function evalFixtureDefinitions() {
  return fixtureFiles;
}

export async function loadEvalFixtureCases(): Promise<Array<{
  agent_name: AgentNameType;
  suite_title: string;
  suite_description: string;
  cases: EvalCaseFixture[];
}>> {
  const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "evals");
  const groups = [];

  for (const definition of fixtureFiles) {
    const raw = await readFile(path.join(fixtureDir, definition.file_name), "utf8");
    const parsed = JSON.parse(raw);
    const cases = evalCaseFixtureSchema.array().parse(parsed);

    groups.push({
      agent_name: definition.agent_name,
      suite_title: definition.suite_title,
      suite_description: definition.suite_description,
      cases
    });
  }

  return groups;
}
