"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { TeacherAccountUtilityLink } from "@/components/teacher-account-utility-link";
import { TeacherLogoutButton } from "@/components/teacher-logout-button";
import { TeacherPrimaryNav } from "@/components/teacher-primary-nav";
import { UAlbertaLogo } from "@/components/ualberta-logo";

const teacherSectionTitles = [
  { pathPrefix: "/teacher/dashboard", title: "Assessment dashboard" },
  { pathPrefix: "/teacher/content", title: "Assessment management" },
  { pathPrefix: "/teacher/students", title: "Student accounts" },
  { pathPrefix: "/teacher/sessions", title: "Student sessions" },
  { pathPrefix: "/teacher/data", title: "Data and outcomes" },
  { pathPrefix: "/teacher/system/llm", title: "LLM status" },
  { pathPrefix: "/teacher/account", title: "Account settings" },
  { pathPrefix: "/teacher/evals", title: "Model evaluation" }
] as const;

function sectionTitle(pathname: string | null) {
  return (
    teacherSectionTitles.find(
      (section) =>
        pathname === section.pathPrefix || pathname?.startsWith(`${section.pathPrefix}/`)
    )?.title ?? "Teacher workspace"
  );
}

export function TeacherWorkspaceHeader({ userId }: { userId: string }) {
  const pathname = usePathname();
  const isAccountPage = pathname === "/teacher/account";

  return (
    <header className="border-b-4 border-ualberta-gold bg-ualberta-green-dark text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
            <UAlbertaLogo className="self-start" compact priority />
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase text-ualberta-gold">
                EDPY 507: Measurement Theory
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                {sectionTitle(pathname)}
              </h1>
              <p className="mt-2 hidden break-words text-sm text-white/80 sm:block">Signed in as {userId}</p>
            </div>
          </div>
          <div className="hidden flex-wrap gap-2 sm:flex">
            {isAccountPage ? null : <TeacherAccountUtilityLink variant="dark" />}
            <TeacherLogoutButton />
          </div>
        </div>
        <div className="hidden sm:block"><TeacherPrimaryNav variant="dark" /></div>
        <details className="sm:hidden" key={pathname}>
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md border border-white/30 px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <Menu className="h-4 w-4" aria-hidden="true" /> Menu
          </summary>
          <div className="space-y-3 pt-3">
            <TeacherPrimaryNav variant="dark" />
            <p className="break-words text-sm text-white/80">Signed in as {userId}</p>
            <div className="flex flex-wrap gap-2">
              {isAccountPage ? null : <TeacherAccountUtilityLink variant="dark" />}
              <TeacherLogoutButton />
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
