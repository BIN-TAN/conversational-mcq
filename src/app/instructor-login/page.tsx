import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { UAlbertaLogo } from "@/components/ualberta-logo";
import { getCurrentUser } from "@/lib/auth";

// Served at /teacher/login (rewrite in next.config.mjs). Teacher pages send signed-out
// visitors here. Students and teachers share the same sign-in API; the account decides
// where the person goes next.
export default async function InstructorLoginPage() {
  const user = await getCurrentUser();
  if (user?.role === "teacher_researcher") {
    redirect("/teacher/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel-gray px-6 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-border-light bg-white shadow-soft">
        <div className="border-b-4 border-ualberta-gold bg-ualberta-green-dark px-6 py-4 text-white">
          <UAlbertaLogo compact priority />
        </div>
        <div className="p-6">
          <h1 className="text-2xl font-semibold text-ink">Instructor sign in</h1>
          <div className="mt-6">
            <LoginForm audience="teacher" />
          </div>
          <p className="mt-6 text-sm text-muted">
            Student?{" "}
            <Link className="font-semibold text-ualberta-green underline-offset-2 hover:underline" href="/student/login">
              Use the student sign-in page
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
