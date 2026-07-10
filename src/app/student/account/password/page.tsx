import { redirect } from "next/navigation";
import { PasswordChangeClient } from "@/components/student-account/password-change-client";
import { UAlbertaLogo } from "@/components/ualberta-logo";
import { getCurrentUser } from "@/lib/auth";

export default async function StudentPasswordPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/student/login");
  }

  if (user.role !== "student") {
    redirect("/teacher/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel-gray px-6 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-border-light bg-white shadow-soft">
        <div className="border-b-4 border-ualberta-gold bg-ualberta-green-dark px-6 py-4 text-white">
          <UAlbertaLogo compact priority />
        </div>
        <div className="p-6">
          <h1 className="text-2xl font-semibold text-ink">Choose a new password</h1>
          <div className="mt-6">
            <PasswordChangeClient mustChangePassword={Boolean(user.must_change_password)} />
          </div>
        </div>
      </section>
    </main>
  );
}
