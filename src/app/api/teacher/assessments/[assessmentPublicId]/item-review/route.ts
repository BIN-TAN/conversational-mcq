import { NextResponse } from "next/server";
import { z } from "zod";
import { contentRouteError, requireTeacherResearcher } from "@/lib/services/content/api";
import { listItemReviews, recordItemReviewDecision } from "@/lib/services/item-review/service";

// Instructor item review (docs/AI_MODULE_REDESIGN_2026-10-19.md, section 4.4). GET lists
// items the profiling model flagged as a possible item issue with what a decision would
// change; POST records the instructor's decision (kept or excluded) for every student.

const decisionSchema = z.object({
  item_public_id: z.string().min(1),
  decision: z.enum(["kept", "excluded"]),
  note: z.string().max(2000).nullable().optional()
}).strict();

export async function GET(
  _request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const { assessmentPublicId } = await context.params;
    const review = await listItemReviews({ teacher_user_db_id: auth.user.user_db_id, assessment_public_id: assessmentPublicId });
    return NextResponse.json({ item_review: review }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contentRouteError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assessmentPublicId: string }> }
) {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  try {
    const { assessmentPublicId } = await context.params;
    const body = decisionSchema.parse(await request.json());
    await recordItemReviewDecision({
      teacher_user_db_id: auth.user.user_db_id,
      assessment_public_id: assessmentPublicId,
      item_public_id: body.item_public_id,
      decision: body.decision,
      note: body.note ?? null
    });
    const review = await listItemReviews({ teacher_user_db_id: auth.user.user_db_id, assessment_public_id: assessmentPublicId });
    return NextResponse.json({ item_review: review }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contentRouteError(error);
  }
}
