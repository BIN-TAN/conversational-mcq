/**
 * Video media (release CMCQ-20261024-11): a YouTube or Vimeo link is shown as a
 * privacy-enhanced embedded player, a direct https link to an .mp4, .webm or .ogg file as a
 * native video player, and anything else stays a link. Pure parsing, no React.
 *
 * Safety rules: https only, no credentials in the URL, the default port only, exact host
 * names (no look-alike or sub-domain matches), and a strict video id format. The embed URL
 * is rebuilt from the id, never copied from the source link.
 */

export const VIDEO_EMBED_FRAME_HOSTS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"] as const;
export const VIDEO_EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation" as const;
export const VIDEO_EMBED_ALLOW = "encrypted-media; picture-in-picture" as const;
export const VIDEO_EMBED_REFERRER_POLICY = "strict-origin-when-cross-origin" as const;

export type VideoPresentation =
  | { kind: "youtube"; video_id: string; embed_url: string }
  | { kind: "vimeo"; video_id: string; embed_url: string }
  | { kind: "file"; file_url: string; mime_type: "video/mp4" | "video/webm" | "video/ogg" }
  | { kind: "link" };

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i;
const FILE_TYPES: Record<string, "video/mp4" | "video/webm" | "video/ogg"> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  ogv: "video/ogg"
};

function parseHttpsUrl(value: string | null | undefined): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;
  return parsed;
}

/** "90", "90s", "1m30s" or "1h2m3s" as whole seconds; null when it is not a time. */
function startSeconds(value: string | null) {
  if (!value) return null;
  if (/^\d{1,6}s?$/.test(value)) return Number.parseInt(value, 10);
  const match = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(value);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    return segments.length === 1 ? segments[0]! : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (segments.length === 1 && segments[0] === "watch") return url.searchParams.get("v");
  if (segments.length === 2 && ["shorts", "embed", "live", "v"].includes(segments[0]!)) return segments[1]!;
  return null;
}

function vimeoIdAndHash(url: URL): { id: string; hash: string | null } | null {
  const host = url.hostname.toLowerCase();
  if (!VIMEO_HOSTS.has(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const queryHash = url.searchParams.get("h");
  if (host === "player.vimeo.com") {
    return segments.length === 2 && segments[0] === "video" ? { id: segments[1]!, hash: queryHash } : null;
  }
  if (segments.length >= 1 && VIMEO_ID.test(segments[0]!)) {
    return { id: segments[0]!, hash: segments[1] ?? queryHash };
  }
  // vimeo.com/channels/<name>/<id> and vimeo.com/groups/<name>/videos/<id>
  if (segments[0] === "channels" && segments.length === 3) return { id: segments[2]!, hash: queryHash };
  if (segments[0] === "groups" && segments.length === 4 && segments[2] === "videos") return { id: segments[3]!, hash: queryHash };
  return null;
}

/** How a video asset's URL is presented. Never throws; unknown or unsafe URLs stay links. */
export function videoPresentationForUrl(value: string | null | undefined): VideoPresentation {
  const url = parseHttpsUrl(value);
  if (!url) return { kind: "link" };

  const youtube = youtubeId(url);
  if (youtube !== null) {
    if (!YOUTUBE_ID.test(youtube)) return { kind: "link" };
    const start = startSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return {
      kind: "youtube",
      video_id: youtube,
      embed_url: `https://www.youtube-nocookie.com/embed/${youtube}${start ? `?start=${start}` : ""}`
    };
  }

  const vimeo = vimeoIdAndHash(url);
  if (vimeo) {
    if (!VIMEO_ID.test(vimeo.id)) return { kind: "link" };
    const hash = vimeo.hash && VIMEO_HASH.test(vimeo.hash) ? vimeo.hash : null;
    return {
      kind: "vimeo",
      video_id: vimeo.id,
      embed_url: `https://player.vimeo.com/video/${vimeo.id}${hash ? `?h=${hash}` : ""}`
    };
  }
  if (VIMEO_HOSTS.has(url.hostname.toLowerCase()) || YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    return { kind: "link" };
  }

  const extension = /\.([a-z0-9]{2,5})$/i.exec(url.pathname)?.[1]?.toLowerCase();
  const mimeType = extension ? FILE_TYPES[extension] : undefined;
  if (mimeType) {
    return { kind: "file", file_url: url.toString(), mime_type: mimeType };
  }

  return { kind: "link" };
}
