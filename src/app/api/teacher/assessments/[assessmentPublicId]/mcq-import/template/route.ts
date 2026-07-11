import { requireTeacherResearcher } from "@/lib/services/content/api";
import { mcqCsvTemplate } from "@/lib/services/content/mcq-import";

export async function GET() {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  return new Response(mcqCsvTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"mcq-import-template.csv\""
    }
  });
}
