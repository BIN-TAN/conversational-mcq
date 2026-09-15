import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function StudentInvitationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/student/login");
  if (user.role !== "teacher_researcher") redirect("/student/assessment");
  redirect("/teacher/students");
}
