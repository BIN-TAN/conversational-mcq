import { McqImportClient } from "@/components/teacher-content/mcq-import-client";

export default async function ImportMcqItemsPage({
  params
}: {
  params: Promise<{ assessmentPublicId: string }>;
}) {
  const { assessmentPublicId } = await params;

  return <McqImportClient assessmentPublicId={assessmentPublicId} />;
}
