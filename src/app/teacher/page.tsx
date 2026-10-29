import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, Cpu, LayoutDashboard, MessagesSquare, Table2, Users, type LucideIcon } from "lucide-react";
import { teacherHomeSections } from "@/components/teacher-home-sections";
import { getCurrentUser } from "@/lib/auth";
import { listItemsAwaitingReview } from "@/lib/services/item-review/service";

const sectionIcons: Record<string, LucideIcon> = {
  "/teacher/dashboard": LayoutDashboard,
  "/teacher/content": ClipboardList,
  "/teacher/students": Users,
  "/teacher/sessions": MessagesSquare,
  "/teacher/data": Table2,
  "/teacher/system/llm": Cpu
};

/** The instructor home page shown after sign-in: one card for each part of the workspace. */
export default async function TeacherHomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/teacher/login");
  }

  if (user.role !== "teacher_researcher") {
    redirect("/student/assessment");
  }

  // Items flagged as a possible problem (when answers were interpreted, or by the tutor in a
  // feedback conversation) that wait for a decision. The home page still loads if this fails.
  const awaitingReview = await listItemsAwaitingReview({ teacher_user_db_id: user.user_db_id }).catch(() => []);

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {awaitingReview.length ? (
          <section
            aria-labelledby="items-awaiting-review"
            className="rounded-lg border border-amber-200 bg-amber-50 p-5"
            data-testid="items-awaiting-review"
          >
            <h2 className="font-semibold text-amber-950" id="items-awaiting-review">
              Items flagged for your review
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-amber-950">
              {awaitingReview.map((entry) => (
                <li key={entry.assessment_public_id}>
                  <Link
                    className="font-semibold underline underline-offset-2"
                    href={`/teacher/dashboard?assessment=${encodeURIComponent(entry.assessment_public_id)}&view=items`}
                  >
                    {entry.title}
                  </Link>
                  {`: ${entry.items_awaiting} ${entry.items_awaiting === 1 ? "item" : "items"}`}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teacherHomeSections.map((section) => {
            const Icon = sectionIcons[section.href] ?? LayoutDashboard;
            return (
              <Link
                className="rounded-lg border border-line bg-white p-5 shadow-soft transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                href={section.href}
                key={section.href}
              >
                <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-ink">{section.label}</h2>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
