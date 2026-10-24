// Session list filters, sort and page kept in the URL query string, so that a reload or
// "Back to sessions" returns to the same list. Pure helpers plus guarded browser storage.

export const SESSION_LIST_STATUSES = ["not_started", "active", "paused", "completed", "student_exited", "needs_review"] as const;
export const SESSION_LIST_PHASES = [
  "not_started",
  "session_started",
  "concept_unit_intro",
  "initial_item_administration",
  "missing_evidence_repair",
  "initial_concept_unit_completed",
  "profiling_pending",
  "profiling_completed",
  "planning_pending",
  "planning_completed",
  "followup_active",
  "followup_profile_update_pending",
  "followup_planning_update_pending",
  "followup_stopped",
  "between_concept_units",
  "session_completed",
  "student_exited",
  "needs_review"
] as const;
export const SESSION_LIST_SORT_FIELDS = ["started_at", "last_activity_at", "completed_at"] as const;
export const SESSION_LIST_PAGE_SIZES = [10, 25, 50, 100] as const;

export type SessionListSortField = (typeof SESSION_LIST_SORT_FIELDS)[number];

export type SessionListFilters = {
  search: string;
  assessment_public_id: string;
  status: string;
  phase: string;
  needs_review: string;
  sort: SessionListSortField;
  direction: "asc" | "desc";
  page: number;
  page_size: number;
};

export const DEFAULT_SESSION_LIST_FILTERS: SessionListFilters = {
  search: "",
  assessment_public_id: "",
  status: "",
  phase: "",
  needs_review: "",
  sort: "last_activity_at",
  direction: "desc",
  page: 1,
  page_size: 25
};

const STORAGE_KEY = "teacher-session-list-query";

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Reads filters from a query string such as "?status=completed&page=2"; unknown values fall back to defaults. */
export function parseSessionListQuery(query: string): SessionListFilters {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("page_size"));
  const needsReview = params.get("needs_review");
  return {
    search: (params.get("search") ?? "").slice(0, 120),
    assessment_public_id: (params.get("assessment_public_id") ?? "").slice(0, 160),
    status: oneOf(params.get("status"), SESSION_LIST_STATUSES) ?? "",
    phase: oneOf(params.get("phase"), SESSION_LIST_PHASES) ?? "",
    needs_review: needsReview === "true" || needsReview === "false" ? needsReview : "",
    sort: oneOf(params.get("sort"), SESSION_LIST_SORT_FIELDS) ?? DEFAULT_SESSION_LIST_FILTERS.sort,
    direction: oneOf(params.get("direction"), ["asc", "desc"] as const) ?? DEFAULT_SESSION_LIST_FILTERS.direction,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    page_size: (SESSION_LIST_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_SESSION_LIST_FILTERS.page_size
  };
}

/** Query string (without "?") holding only the values that differ from the defaults. */
export function serializeSessionListQuery(filters: SessionListFilters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_SESSION_LIST_FILTERS) as Array<keyof SessionListFilters>) {
    const value = key === "search" ? filters.search.trim() : filters[key];
    if (value !== DEFAULT_SESSION_LIST_FILTERS[key] && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function sessionListHref(query: string | null) {
  return query ? `/teacher/sessions?${query}` : "/teacher/sessions";
}

export function hasActiveSessionListFilters(filters: SessionListFilters) {
  return Boolean(filters.search.trim() || filters.assessment_public_id || filters.status || filters.phase || filters.needs_review);
}

export function storeSessionListQuery(query: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, query);
  } catch {
    // Storage can be unavailable (private window, blocked site data); the list still works.
  }
}

export function readStoredSessionListQuery(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
