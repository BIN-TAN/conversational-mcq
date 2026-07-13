import { redirect } from "next/navigation";
import { AccountSettingsClient } from "@/components/teacher-account/account-settings-client";
import { TeacherLogoutButton } from "@/components/teacher-logout-button";
import { TeacherPrimaryNav } from "@/components/teacher-primary-nav";
import { UAlbertaLogo } from "@/components/ualberta-logo";
import { getCurrentUser } from "@/lib/auth";
import { getTeacherPasswordAccount } from "@/lib/services/account-security/teacher-account-security";

export default async function TeacherAccountPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  const account = await getTeacherPasswordAccount({ userDbId: user.user_db_id });

  return (
    <main className="min-h-screen bg-panel-gray">
      <header className="border-b-4 border-ualberta-gold bg-ualberta-green-dark text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <UAlbertaLogo compact priority />
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-ualberta-gold">
                  EDPY 507: Measurement Theory
                </p>
                <h1 className="mt-2 text-3xl font-semibold text-white">Account settings</h1>
                <p className="mt-2 text-sm text-white/80">Signed in as {user.user_id}</p>
              </div>
            </div>
            <TeacherLogoutButton />
          </div>
          <TeacherPrimaryNav variant="dark" />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        <AccountSettingsClient initialAccount={account} />
      </div>
    </main>
  );
}
