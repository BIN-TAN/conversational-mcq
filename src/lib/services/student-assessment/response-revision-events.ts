type RevisionEvent = { event_type: string; event_category?: string | null; payload?: unknown };

export function isConfidenceRevisionEvent(event: RevisionEvent): boolean {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : {};
  return event.event_type === "confidence_changed" ||
    (event.event_type === "confidence_selected" && payload.revised === true) ||
    // The legacy package-review route emitted this only when the value changed.
    (event.event_type === "confidence_clicked" && event.event_category === "package_review");
}

export function isAlternativeRevisionEvent(event: RevisionEvent): boolean {
  return event.event_type === "tempting_option_changed" ||
    (event.event_type === "tempting_option_submitted" && event.event_category === "package_review");
}
