import { redirect } from "next/navigation";
import { AccountSettingsClient } from "@/components/teacher-account/account-settings-client";
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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AccountSettingsClient initialAccount={account} />
    </main>
  );
}
