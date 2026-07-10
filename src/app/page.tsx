import Link from "next/link";
import { BookOpenCheck, LayoutDashboard } from "lucide-react";
import { UAlbertaLogo } from "@/components/ualberta-logo";

const links = [
  {
    href: "/student/login",
    label: "Student Access",
    icon: BookOpenCheck
  },
  {
    href: "/teacher/dashboard",
    label: "Instructor Dashboard",
    icon: LayoutDashboard
  }
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b-4 border-ualberta-gold bg-ualberta-green-dark text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <UAlbertaLogo priority />
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wide text-ualberta-gold">EDPY 507</p>
              <p className="text-xs uppercase tracking-wide text-white/80">Measurement Theory</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm font-semibold" aria-label="Primary navigation">
            <Link className="rounded-md px-3 py-2 text-white/90 hover:bg-white/10 hover:text-white" href="/student/login">
              Student Access
            </Link>
            <Link className="rounded-md px-3 py-2 text-white/90 hover:bg-white/10 hover:text-white" href="/teacher/dashboard">
              Instructor Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <section className="rounded-lg border border-border-light bg-panel-gray p-6 md:p-8">
          <div className="h-1 w-24 rounded-full bg-ualberta-gold" aria-hidden="true" />
          <h1 className="mt-6 text-4xl font-semibold text-ink md:text-5xl">
            EDPY 507: Measurement Theory
          </h1>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {links.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                className="group rounded-lg border border-border-light bg-white p-6 shadow-soft transition hover:-translate-y-0.5 hover:border-ualberta-green"
                href={item.href}
                key={item.href}
                aria-label={item.label}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-ualberta-green-soft text-ualberta-green">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="mt-5 h-1 w-12 rounded-full bg-ualberta-gold transition group-hover:w-16" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-semibold text-ualberta-green-dark">{item.label}</h2>
              </Link>
            );
          })}
        </section>

        <section
          aria-label="Course support"
          className="rounded-lg border border-border-light bg-ualberta-gold-soft p-5 text-sm leading-6 text-ink"
        >
          <p className="text-muted">This site supports the EDPY 507 formative assessment activity.</p>
        </section>
      </div>
    </main>
  );
}
