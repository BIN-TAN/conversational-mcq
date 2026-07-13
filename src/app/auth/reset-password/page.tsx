import { ResetPasswordClient } from "@/components/account-security/reset-password-client";
import { UAlbertaLogo } from "@/components/ualberta-logo";

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel-gray px-6 py-10">
      <section className="w-full max-w-md overflow-hidden rounded-lg border border-border-light bg-white shadow-soft">
        <div className="border-b-4 border-ualberta-gold bg-ualberta-green-dark px-6 py-4 text-white">
          <UAlbertaLogo compact priority />
        </div>
        <div className="p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-ualberta-green">
            EDPY 507: Measurement Theory
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-ink">Reset teacher password</h1>
          <div className="mt-6">
            <ResetPasswordClient token={token} tokenPresent={token.length > 0} />
          </div>
        </div>
      </section>
    </main>
  );
}

