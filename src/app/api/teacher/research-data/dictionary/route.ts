import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import {
  dataDictionaryCsv,
  dictionaryFilterOptions,
  filterDictionaryEntries,
  dictionaryStats,
  buildAnalysisReadyDictionaryEntries,
  paginateDictionaryEntries,
  DATA_DICTIONARY_PAGE_SIZES,
  RESEARCH_DATA_DICTIONARY_VERSION
} from "@/lib/services/teacher-research-data/dictionary";

function dictionaryQuery(url: URL) {
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("page_size") ?? "100");
  const search = url.searchParams.get("search")?.trim() ?? "";

  if (!Number.isFinite(page) || page < 1) {
    throw new ContentServiceError("validation_failed", "Data dictionary page must be at least 1.", 400);
  }
  if (!DATA_DICTIONARY_PAGE_SIZES.includes(pageSize as (typeof DATA_DICTIONARY_PAGE_SIZES)[number])) {
    throw new ContentServiceError("validation_failed", "Data dictionary page size is not supported.", 400);
  }
  if (search.length > 120) {
    throw new ContentServiceError("validation_failed", "Data dictionary search is too long.", 400);
  }

  return {
    page,
    page_size: pageSize,
    search,
    category: url.searchParams.get("category") ?? undefined,
    table_name: url.searchParams.get("table_name") ?? undefined,
    source_type: url.searchParams.get("source_type") ?? undefined,
    privacy_level: url.searchParams.get("privacy_level") ?? undefined,
    export_tier: url.searchParams.get("export_tier") ?? undefined,
    derivation: url.searchParams.get("derivation") ?? undefined,
    field_family: url.searchParams.get("field_family") ?? undefined,
    deprecated: url.searchParams.get("deprecated") ?? undefined
  };
}

function assertKnownFilterValues(
  query: ReturnType<typeof dictionaryQuery>,
  options: ReturnType<typeof dictionaryFilterOptions>
) {
  const checks: Array<[keyof ReturnType<typeof dictionaryQuery>, readonly string[]]> = [
    ["category", options.categories],
    ["table_name", options.table_names],
    ["source_type", options.source_types],
    ["privacy_level", options.privacy_levels],
    ["export_tier", options.export_tiers],
    ["derivation", options.derivations],
    ["field_family", options.field_families],
    ["deprecated", options.deprecated_values]
  ];
  for (const [key, allowed] of checks) {
    const value = query[key];
    if (typeof value === "string" && value !== "all" && !allowed.includes(value)) {
      throw new ContentServiceError("validation_failed", `Unknown data dictionary filter: ${key}.`, 400);
    }
  }
}

export async function GET(request: Request) {
  const auth = await requireTeacherResearcher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const entries = buildAnalysisReadyDictionaryEntries();
    const url = new URL(request.url);
    const query = dictionaryQuery(url);
    const filterOptions = dictionaryFilterOptions(entries);
    assertKnownFilterValues(query, filterOptions);
    const filteredEntries = filterDictionaryEntries(entries, query);
    if (url.searchParams.get("format") === "json") {
      const page = paginateDictionaryEntries(filteredEntries, query);
      return NextResponse.json({
        dictionary_version: RESEARCH_DATA_DICTIONARY_VERSION,
        stats: dictionaryStats(entries),
        ...page,
        category_counts: dictionaryStats(filteredEntries).by_category,
        filters: {
          search: query.search,
          category: query.category ?? "all",
          table_name: query.table_name ?? "all",
          source_type: query.source_type ?? "all",
          privacy_level: query.privacy_level ?? "all",
          export_tier: query.export_tier ?? "all",
          derivation: query.derivation ?? "all",
          field_family: query.field_family ?? "all",
          deprecated: query.deprecated ?? "all"
        },
        filter_options: filterOptions
      });
    }

    return new NextResponse(dataDictionaryCsv(filteredEntries), {
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
