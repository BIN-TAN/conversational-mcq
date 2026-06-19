import { LoginForm } from "@/components/login-form";

export default function StudentLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-soft">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">
          Classroom access
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Students need a classroom ID and roster-issued access code or password. Teacher
          researchers sign in with their password.
        </p>
        <div className="mt-6">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
