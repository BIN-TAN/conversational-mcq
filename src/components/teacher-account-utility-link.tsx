import Link from "next/link";

export function TeacherAccountUtilityLink({ variant = "light" }: { variant?: "light" | "dark" }) {
  const className =
    variant === "dark"
      ? "inline-flex h-9 items-center rounded-md border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white transition hover:border-ualberta-gold hover:bg-white/10"
      : "inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink transition hover:border-accent";

  return (
    <Link className={className} href="/teacher/account">
      Account settings
    </Link>
  );
}

