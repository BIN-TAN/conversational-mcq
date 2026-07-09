import Link from "next/link";
import { BookOpenCheck, LayoutDashboard } from "lucide-react";

const links = [
  {
    href: "/student/login",
    label: "Student Login",
    description: "Students enter with the classroom ID and access credential provided by the instructor.",
    icon: BookOpenCheck
  },
  {
    href: "/teacher/dashboard",
    label: "Instructor Dashboard",
    description: "Instructor access for student account management, session review, evidence audit, and research-data export.",
    icon: LayoutDashboard
  }
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            EDPY 507 course activity
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-ink">EDPY 507: Measurement Theory</h1>
          <p className="mt-4 text-base leading-7 text-muted">
            Access the Measurement Theory practice activity and instructor review tools for this
            course.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {links.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-accent"
                href={item.href}
                key={item.href}
              >
                <Icon className="h-6 w-6 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-ink">{item.label}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{item.description}</p>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
