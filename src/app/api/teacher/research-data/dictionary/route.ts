import { NextResponse } from "next/server";
import { requireTeacherResearcher, contentRouteError } from "@/lib/services/content/api";
import { ContentServiceError } from "@/lib/services/content/errors";
import {
  dictionaryCsvForEntityType,
  dictionaryEntriesForEntityType,
  dictionaryFilterOptions,
  filterDictionaryEntries,
  dictionaryStats,
  paginateDictionaryEntries,
  DATA_DICTIONARY_PAGE_SIZES,
  RESEARCH_DATA_DICTIONARY_SCHEMA_VERSION,
  type DictionaryEntityType
} from "@/lib/services/teacher-research-data/dictionary";

const dictionaryEntityTypes: DictionaryEntityType[] = [
  "research_variable",
  "process_event_code",
  "internal_schema_field",
  "excluded_platform_field"
];

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
    entity_type: (url.searchParams.get("entity_type") ?? "research_variable") as DictionaryEntityType,
    search,
    category: url.searchParams.get("category") ?? undefined,
    table_name: url.searchParams.get("table_name") ?? undefined,
    measurement_level: url.searchParams.get("measurement_level") ?? undefined,
    actor_or_source: url.searchParams.get("actor_or_source") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
    source_nature: url.searchParams.get("source_nature") ?? undefined,
    privacy_level: url.searchParams.get("privacy_level") ?? undefined,
    permitted_audience: url.searchParams.get("permitted_audience") ?? undefined,
    export_policy: url.searchParams.get("export_policy") ?? undefined,
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
    ["entity_type", dictionaryEntityTypes],
    ["category", options.categories],
    ["table_name", options.table_names],
    ["measurement_level", options.measurement_levels],
    ["actor_or_source", options.actor_or_sources],
    ["scope", options.scopes],
    ["source_nature", options.source_natures],
    ["privacy_level", options.privacy_levels],
    ["permitted_audience", options.permitted_audiences],
    ["export_policy", options.export_policies],
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
    const url = new URL(request.url);
    const query = dictionaryQuery(url);
    if (!dictionaryEntityTypes.includes(query.entity_type)) {
      throw new ContentServiceError("validation_failed", "Unknown data dictionary entity type.", 400);
    }
    const entries = dictionaryEntriesForEntityType(query.entity_type);
    const filterOptions = dictionaryFilterOptions(entries);
    assertKnownFilterValues(query, filterOptions);
    const filteredEntries = filterDictionaryEntries(entries, query);
    if (url.searchParams.get("format") === "json") {
      const page = paginateDictionaryEntries(filteredEntries, query);
      return NextResponse.json({
        dictionary_version: RESEARCH_DATA_DICTIONARY_SCHEMA_VERSION,
        entity_type: query.entity_type,
        stats: dictionaryStats(entries),
        ...page,
        category_counts: dictionaryStats(filteredEntries).by_category,
        filters: {
          entity_type: query.entity_type,
          search: query.search,
          category: query.category ?? "all",
          table_name: query.table_name ?? "all",
          measurement_level: query.measurement_level ?? "all",
          actor_or_source: query.actor_or_source ?? "all",
          scope: query.scope ?? "all",
          source_nature: query.source_nature ?? "all",
          privacy_level: query.privacy_level ?? "all",
          permitted_audience: query.permitted_audience ?? "all",
          export_policy: query.export_policy ?? "all",
          derivation: query.derivation ?? "all",
          field_family: query.field_family ?? "all",
          deprecated: query.deprecated ?? "all"
        },
        filter_options: filterOptions
      });
    }

    const filename =
      query.entity_type === "process_event_code"
        ? "process_event_codebook.csv"
        : query.entity_type === "internal_schema_field"
          ? "internal_schema_appendix.csv"
          : query.entity_type === "excluded_platform_field"
            ? "excluded_platform_variables.csv"
            : "research_data_dictionary.csv";

    return new NextResponse(dictionaryCsvForEntityType(query.entity_type, filteredEntries), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return contentRouteError(error);
  }
}
