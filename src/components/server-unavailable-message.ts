/**
 * Shown when a page receives a web page in place of data: the hosting platform answered
 * while the application was restarting for an update or was unreachable.
 */
export const SERVER_UNAVAILABLE_MESSAGE =
  "The server did not answer normally, usually because the application is restarting for an update. Nothing on this page has changed. Wait a minute, then try again.";

/** Shown when the browser could not reach the server at all (no connection, or a restart). */
export const SERVER_UNREACHABLE_MESSAGE =
  "The server could not be reached. Check your internet connection, wait a minute, then try again. Nothing on this page has changed.";

/** The browser's own error for a request that never reached the server ("Failed to fetch"). */
export function isNetworkFailure(caught: unknown) {
  return caught instanceof TypeError && /fetch|network|load failed/i.test(caught.message);
}

/** A readable message for a failed request, never the browser's technical wording. */
export function requestErrorMessage(caught: unknown, fallback: string) {
  if (isNetworkFailure(caught)) return SERVER_UNREACHABLE_MESSAGE;
  return caught instanceof Error && caught.message ? caught.message : fallback;
}
