import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import {
  dataDictionaryCsv,
  dictionaryStats,
  buildAnalysisReadyDictionaryEntries,
  RESEARCH_DATA_DICTIONARY_VERSION
} from "@/lib/services/teacher-research-data/dictionary";

export async function GET(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const entries = buildAnalysisReadyDictionaryEntries();
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "json") {
      return NextResponse.json({
        dictionary_version: RESEARCH_DATA_DICTIONARY_VERSION,
        stats: dictionaryStats(entries),
        entries
      });
    }

    return new NextResponse(dataDictionaryCsv(entries), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"data_dictionary.csv\"",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contentRouteError(error);
  }
}

