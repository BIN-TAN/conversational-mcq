import { redirect } from "next/navigation";

export default function DeprecatedTeacherMasterExportPage() {
  redirect("/teacher/data/research?tab=analysis");
}
