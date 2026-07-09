import { redirect } from "next/navigation";
import { PasswordChangeClient } from "@/components/student-account/password-change-client";
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
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-soft">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">Student account</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Change password</h1>
        <div className="mt-6">
          <PasswordChangeClient mustChangePassword={Boolean(user.must_change_password)} />
        </div>
      </section>
    </main>
  );
}
