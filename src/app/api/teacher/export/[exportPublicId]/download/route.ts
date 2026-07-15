import {
  masterExportRouteError,
  requireMasterExportTeacher
} from "@/lib/services/master-export/api";
import { getExportDownload } from "@/lib/services/master-export/service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ exportPublicId: string }> }
) {
  const auth = await requireMasterExportTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const params = await context.params;
    const download = await getExportDownload(params.exportPublicId);

    return new Response(download.bytes, {
      headers: {
        "Content-Type": download.content_type,
        "Content-Disposition": `attachment; filename="${download.file_name}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return masterExportRouteError(error);
  }
}
