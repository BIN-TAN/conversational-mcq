import React from "react";
import {
  VIDEO_EMBED_ALLOW,
  VIDEO_EMBED_REFERRER_POLICY,
  VIDEO_EMBED_SANDBOX,
  videoPresentationForUrl
} from "@/lib/item-content/video-embed";

/**
 * A video asset as a player (release CMCQ-20261024-11): YouTube through youtube-nocookie.com
 * and Vimeo through player.vimeo.com in a sandboxed, lazily loaded frame, or a direct https
 * .mp4/.webm/.ogg file in a native player. Returns null for any other URL, so the caller's
 * link stays the only way to open it. Callers show it only where links are interactive (not
 * inside an answer button), and always keep the link and description below as a fallback.
 */
export function ItemVideoEmbed({
  url,
  title,
  testId
}: {
  url: string | null | undefined;
  title: string;
  testId?: string;
}) {
  const presentation = videoPresentationForUrl(url);

  if (presentation.kind === "youtube" || presentation.kind === "vimeo") {
    return (
      <div className="item-media-embed mb-2" data-testid={testId ?? "item-media-video-embed"}>
        <iframe
          allow={VIDEO_EMBED_ALLOW}
          allowFullScreen
          loading="lazy"
          referrerPolicy={VIDEO_EMBED_REFERRER_POLICY}
          sandbox={VIDEO_EMBED_SANDBOX}
          src={presentation.embed_url}
          title={title}
        />
      </div>
    );
  }

  if (presentation.kind === "file") {
    return (
      <video
        aria-label={title}
        className="mb-2 max-h-80 w-full rounded-lg bg-black"
        controls
        data-testid={testId ?? "item-media-video-file"}
        preload="metadata"
      >
        <source src={presentation.file_url} type={presentation.mime_type} />
      </video>
    );
  }

  return null;
}
