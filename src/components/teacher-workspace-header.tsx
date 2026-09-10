"use client";

import { usePathname } from "next/navigation";
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
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
            <UAlbertaLogo compact priority />
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase text-ualberta-gold">
                EDPY 507: Measurement Theory
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-white">
                {sectionTitle(pathname)}
              </h1>
              <p className="mt-2 break-words text-sm text-white/80">Signed in as {userId}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAccountPage ? null : <TeacherAccountUtilityLink variant="dark" />}
            <TeacherLogoutButton />
          </div>
        </div>
        <TeacherPrimaryNav variant="dark" />
      </div>
    </header>
  );
}
