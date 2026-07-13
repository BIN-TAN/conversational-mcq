import Link from "next/link";
import { UAlbertaLogo } from "@/components/ualberta-logo";
import {
  publicAccountSecurityError,
  verifyTeacherEmailChangeToken
} from "@/lib/services/account-security/teacher-account-security";

export default async function VerifyTeacherEmailPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  let status: "success" | "failed" = "success";
  let message = "Your recovery email has been verified. Please sign in again if prompted.";

  try {
    await verifyTeacherEmailChangeToken({ token: params.token ?? "" });
  } catch (error) {
    const safe = publicAccountSecurityError(error);
    status = "failed";
    message = safe.message;
  }

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
          <h2 className="text-xl font-semibold text-ink">
            {status === "success" ? "Recovery email verified" : "Verification link unavailable"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">{message}</p>
          <Link
            className="mt-5 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white"
            href="/student/login"
          >
            Return to sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
