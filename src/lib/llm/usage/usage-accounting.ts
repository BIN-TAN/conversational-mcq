import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LiveModelRole, type LiveModelRole as LiveModelRoleType } from "@/lib/llm/config";
import { getLlmUsageLimitConfig } from "./usage-limits";

type TokenRow = {
  agent_name: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost: Prisma.Decimal | null;
};

export type LlmUsageSummary = {
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  cost_estimation_available: boolean;
};

export type LlmUsageSnapshot = {
  usage_timezone: string;
  window_start: string;
  window_end: string;
  provider: "openai";
  requested_agent_name: LiveModelRoleType;
  assessment_session_db_id: string | null;
  student_user_id: string | null;
  session_public_id: string | null;
  class_daily: LlmUsageSummary;
  student_daily: LlmUsageSummary | null;
  session: LlmUsageSummary | null;
  agent_session: LlmUsageSummary | null;
  per_agent_daily: Record<string, LlmUsageSummary>;
};

export type LlmUsageSnapshotInput = {
  agent_name: LiveModelRoleType;
  assessment_session_db_id?: string | null;
  now?: Date;
};

function datePartsForTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function timeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = datePartsForTimeZone(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function zonedMidnightToUtc(year: number, month: number, day: number, timeZone: string) {
  const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = new Date(localMidnightAsUtc - timeZoneOffsetMs(timeZone, new Date(localMidnightAsUtc)));

  return new Date(localMidnightAsUtc - timeZoneOffsetMs(timeZone, firstPass));
}

export function getUsageWindow(now = new Date(), timeZone = getLlmUsageLimitConfig().usage_timezone) {
  const parts = datePartsForTimeZone(now, timeZone);
  const start = zonedMidnightToUtc(parts.year, parts.month, parts.day, timeZone);
  const localNextDayAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0);
  const firstPassEnd = new Date(
    localNextDayAsUtc - timeZoneOffsetMs(timeZone, new Date(localNextDayAsUtc))
  );
  const end = new Date(localNextDayAsUtc - timeZoneOffsetMs(timeZone, firstPassEnd));

  return { start, end };
}

function summarize(rows: TokenRow[]): LlmUsageSummary {
  let estimatedCost = 0;
  let costRows = 0;

  for (const row of rows) {
    if (row.estimated_cost !== null) {
      estimatedCost += Number(row.estimated_cost.toString());
      costRows += 1;
    }
  }

  return {
    call_count: rows.length,
    input_tokens: rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
    output_tokens: rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
    total_tokens: rows.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
    estimated_cost_usd: costRows > 0 ? estimatedCost : null,
    cost_estimation_available: costRows > 0
  };
}

function emptySummary(): LlmUsageSummary {
  return summarize([]);
}

function perAgentSummary(rows: TokenRow[]) {
  return Object.fromEntries(
    LiveModelRole.options.map((agentName) => [
      agentName,
      summarize(rows.filter((row) => row.agent_name === agentName))
    ])
  );
}

async function usageRows(where: Prisma.AgentCallWhereInput) {
  return prisma.agentCall.findMany({
    where,
    select: {
      agent_name: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      estimated_cost: true
    }
  });
}

export async function getLlmUsageSnapshot(input: LlmUsageSnapshotInput): Promise<LlmUsageSnapshot> {
  const agentName = LiveModelRole.parse(input.agent_name);
  const limits = getLlmUsageLimitConfig();
  const window = getUsageWindow(input.now ?? new Date(), limits.usage_timezone);
  const assessmentSessionId = input.assessment_session_db_id ?? null;
  const dayWhere = {
    provider: "openai",
    created_at: {
      gte: window.start,
      lt: window.end
    }
  } satisfies Prisma.AgentCallWhereInput;
  const [dailyRows, session] = await Promise.all([
    usageRows(dayWhere),
    assessmentSessionId
      ? prisma.assessmentSession.findUnique({
          where: { id: assessmentSessionId },
          select: {
            id: true,
            session_public_id: true,
            user_db_id: true,
            user: { select: { user_id: true } }
          }
        })
      : Promise.resolve(null)
  ]);
  const studentRows = session
    ? await usageRows({
        ...dayWhere,
        assessment_session: {
          user_db_id: session.user_db_id
        }
      })
    : null;
  const sessionRows = session
    ? await usageRows({
        provider: "openai",
        assessment_session_db_id: session.id
      })
    : null;
  const agentSessionRows = sessionRows?.filter((row) => row.agent_name === agentName) ?? null;

  return {
    usage_timezone: limits.usage_timezone,
    window_start: window.start.toISOString(),
    window_end: window.end.toISOString(),
    provider: "openai",
    requested_agent_name: agentName,
    assessment_session_db_id: assessmentSessionId,
    student_user_id: session?.user.user_id ?? null,
    session_public_id: session?.session_public_id ?? null,
    class_daily: summarize(dailyRows),
    student_daily: studentRows ? summarize(studentRows) : null,
    session: sessionRows ? summarize(sessionRows) : null,
    agent_session: agentSessionRows ? summarize(agentSessionRows) : null,
    per_agent_daily: perAgentSummary(dailyRows)
  };
}

export function summarizeUsageRowsForTest(rows: TokenRow[]) {
  return rows.length === 0 ? emptySummary() : summarize(rows);
}
