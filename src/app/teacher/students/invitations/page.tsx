import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { StudentInvitationsClient } from "@/components/teacher-students/student-invitations-client";

export default async function StudentInvitationsPage({ searchParams }: { searchParams: Promise<{ student?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/student/login");
  if (user.role !== "teacher_researcher") redirect("/student/assessment");
  const selection = (await searchParams).student;
  const ids = (Array.isArray(selection) ? selection : selection ? [selection] : []).slice(0, 100);
  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><StudentInvitationsClient initialStudentIds={ids} /></main>;
}
