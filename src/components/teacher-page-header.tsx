import type { ReactNode } from "react";

export function TeacherPageHeader({
  title,
  metadata,
  actions
}: {
  title: string;
  metadata?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-line pb-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-ink">{title}</h1>
          {metadata ? <div className="mt-2 text-sm leading-6 text-muted">{metadata}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
