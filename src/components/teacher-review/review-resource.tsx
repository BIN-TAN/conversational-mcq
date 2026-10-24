"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { errorFromUnknown } from "./api";
import type { StructuredApiError } from "./types";
import { ErrorState, LoadingState } from "./ui";

export function useReviewResource<T>(sessionPublicId: string, revision: number, enabled: boolean, load: (id: string) => Promise<T>) {
  const key = `${sessionPublicId}:${revision}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: StructuredApiError | null } | null>(null);
  const loadedKey = state?.key;
  useEffect(() => {
    if (!enabled || loadedKey === key) return;
    let current = true;
    void load(sessionPublicId).then(
      (data) => { if (current) setState({ key, data, error: null }); },
      (error) => { if (current) setState({ key, data: null, error: errorFromUnknown(error) }); }
    );
    return () => { current = false; };
  }, [enabled, key, loadedKey, load, sessionPublicId]);
  // While a newer revision of the same session loads, the previous data stays on screen.
  const stale = state !== null && state.key !== key && state.key.startsWith(`${sessionPublicId}:`) && state.data !== null;
  const loading = enabled && loadedKey !== key;
  return {
    data: state?.key === key ? state.data : stale ? state.data : null,
    error: state?.key === key ? state.error : null,
    loading,
    refreshing: loading && stale,
    retry: () => setState(null)
  };
}

export function ReviewResourceStatus({ resource }: { resource: { loading: boolean; refreshing?: boolean; error: StructuredApiError | null; retry: () => void } }) {
  if (resource.refreshing) {
    return <p className="flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Updating...
    </p>;
  }
  if (resource.loading) return <LoadingState />;
  if (!resource.error) return null;
  return <div className="space-y-3" role="alert">
    <ErrorState error={resource.error} />
    <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold" onClick={resource.retry}>
      <RefreshCw size={16} aria-hidden="true" />Retry this section
    </button>
  </div>;
}
