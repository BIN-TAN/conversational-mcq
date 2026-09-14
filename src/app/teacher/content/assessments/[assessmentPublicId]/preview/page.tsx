import { AssessmentPreviewClient } from "@/components/teacher-content/assessment-preview";

export default async function AssessmentPreviewPage({
  params
}: {
  params: Promise<{ assessmentPublicId: string }>;
}) {
  const { assessmentPublicId } = await params;

  return <AssessmentPreviewClient assessmentPublicId={assessmentPublicId} key={assessmentPublicId} />;
}
