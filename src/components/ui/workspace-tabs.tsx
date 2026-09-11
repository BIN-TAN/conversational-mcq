"use client";

import type { ReactNode } from "react";

export function WorkspaceTabs<T extends string>({
  id,
  label,
  tabs,
  value,
  onChange
}: {
  id: string;
  label: string;
  tabs: Array<{ id: T; label: string; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="flex min-w-0 flex-wrap gap-2" role="tablist">
      {tabs.map((tab, index) => (
        <button
          aria-controls={`${id}-panel`}
          aria-selected={value === tab.id}
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${value === tab.id ? "bg-accent text-white" : "border border-line bg-white text-ink hover:border-accent"}`}
          id={`${id}-tab-${tab.id}`}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else return;
            event.preventDefault();
            onChange(tabs[next]!.id);
            document.getElementById(`${id}-tab-${tabs[next]!.id}`)?.focus();
          }}
          role="tab"
          tabIndex={value === tab.id ? 0 : -1}
          type="button"
        >
          {tab.icon}{tab.label}
        </button>
      ))}
    </div>
  );
}
