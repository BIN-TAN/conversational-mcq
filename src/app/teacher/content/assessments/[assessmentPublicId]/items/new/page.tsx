import { ItemEditorClient } from "@/components/teacher-content/item-editor-client";

export default async function NewAssessmentItemPage({
  params
}: {
  params: Promise<{ assessmentPublicId: string }>;
}) {
  const { assessmentPublicId } = await params;

  return <ItemEditorClient assessmentPublicId={assessmentPublicId} mode="create" />;
}
