import { LoginForm } from "@/components/login-form";
import { UAlbertaLogo } from "@/components/ualberta-logo";

export default function StudentLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-panel-gray px-6 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-border-light bg-white shadow-soft">
        <div className="border-b-4 border-ualberta-gold bg-ualberta-green-dark px-6 py-4 text-white">
          <UAlbertaLogo compact priority />
        </div>
        <div className="p-6">
          <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
          <div className="mt-6">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  );
}
