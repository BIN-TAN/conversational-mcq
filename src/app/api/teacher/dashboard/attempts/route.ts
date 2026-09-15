import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import { buildAttemptComparison, loadAttemptObservations } from "@/lib/services/teacher-dashboard/attempt-comparison";

const querySchema = z.object({ assessment_public_id: z.string().min(1).max(200),
  pair: z.enum(["1-2", "2-3", "1-3", "first-latest"]).default("1-2"),
  mode: z.enum(["all", "matched"]).default("all"), all_three: z.enum(["true", "false"]).default("false"),
  objective: z.string().max(2000).optional() });

export async function GET(request: Request) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const comparison = await prisma.$transaction(async tx => {
      const assessment = await tx.assessment.findFirst({ where: { assessment_public_id: query.assessment_public_id,
        created_by_user_db_id: auth.user.user_db_id }, select: { id: true } });
      if (!assessment) throw new ContentServiceError("not_found", "Assessment was not found.", 404);
      const [snapshot] = await tx.$queryRaw<Array<{ at: Date }>>`SELECT transaction_timestamp() AS at`;
      const observations = await loadAttemptObservations(tx, { assessment_db_id: assessment.id, user: { role: "student" } });
      const roster = await tx.user.findMany({ where: { role: "student", account_status: "active",
        created_by_teacher_user_id: auth.user.user_db_id }, select: { user_id: true } });
      const eligible = new Set(roster.length ? roster.map(user => user.user_id) : observations.map(row => row.student_key));
      const result = buildAttemptComparison(observations.filter(row => eligible.has(row.student_key)), {
        ...query, all_three: query.all_three === "true", eligible_student_count: eligible.size, snapshot_at: snapshot.at.toISOString()
      });
      // Classroom summaries do not need identifiable student-level evidence rows.
      const { transitions: _transitions, ...summary } = result;
      void _transitions;
      return summary;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
    return NextResponse.json({ comparison }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return contentRouteError(error); }
}
