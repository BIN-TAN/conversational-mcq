import React from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

const allowedTutorMessageElements = [
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "br"
] as const;

const tutorMessageComponents: Components = {
  p: ({ children }) => (
    <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent/40 pl-3 text-inherit">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-inherit">
      {children}
    </code>
  )
};

export function SafeTutorMessageMarkdown({
  className,
  message
}: {
  className?: string;
  message: string;
}) {
  return (
    <div
      className={["min-w-0 text-sm leading-6", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="safe-tutor-message-markdown"
    >
      <ReactMarkdown
        allowedElements={allowedTutorMessageElements}
        components={tutorMessageComponents}
        skipHtml
        unwrapDisallowed
        urlTransform={() => null}
      >
        {message}
      </ReactMarkdown>
    </div>
  );
}
