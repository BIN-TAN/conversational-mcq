import { NextResponse } from "next/server";
import {
  requireTeacherReview,
  teacherReviewRouteError
} from "@/lib/services/teacher-review/api";
import {
  getTeacherReadableTranscript,
  renderTeacherReadableTranscriptMarkdown
} from "@/lib/services/teacher-review/readable-transcript";

function safeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionPublicId: string }> }
) {
  const auth = await requireTeacherReview();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const transcript = await getTeacherReadableTranscript(params.sessionPublicId);
    const body = renderTeacherReadableTranscriptMarkdown(transcript);
    const filename = `${safeFilenamePart(transcript.session_public_id)}-readable-transcript.md`;

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return teacherReviewRouteError(error);
  }
}
