"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { teacherPrimaryNavItems, type TeacherPrimaryNavItem } from "./teacher-primary-nav-items";

type TeacherPrimaryNavProps = {
  variant?: "light" | "dark";
};

function isActiveNavItem(item: TeacherPrimaryNavItem, pathname: string | null) {
  if (!pathname) {
    return false;
  }

  if (item.exact) {
    return pathname === item.activePathPrefix;
  }

  return pathname === item.activePathPrefix || pathname.startsWith(`${item.activePathPrefix}/`);
}

function navLinkClassName(variant: "light" | "dark", isActive: boolean) {
  if (variant === "dark") {
    const base =
      "rounded-md border px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ualberta-gold";
    const state = isActive
      ? "border-ualberta-gold bg-ualberta-gold text-ualberta-green-dark"
      : "border-white/15 bg-white/5 text-white/90 hover:border-ualberta-gold hover:bg-white/10 hover:text-white";
    return `${base} ${state}`;
  }

  const base =
    "rounded-md border px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const state = isActive
    ? "border-accent bg-accent-soft text-ink shadow-sm"
    : "border-line bg-white text-ink hover:border-accent";
  return `${base} ${state}`;
}

export function TeacherPrimaryNav({ variant = "light" }: TeacherPrimaryNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Teacher primary navigation"
      className="flex flex-wrap items-center gap-2"
    >
      {teacherPrimaryNavItems.map((item) => {
        const active = isActiveNavItem(item, pathname);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={navLinkClassName(variant, active)}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
