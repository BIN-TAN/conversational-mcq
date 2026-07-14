import { redirect } from "next/navigation";

export default function DeprecatedTeacherDataExplorerPage() {
  redirect("/teacher/data/research?section=dataset");
}
