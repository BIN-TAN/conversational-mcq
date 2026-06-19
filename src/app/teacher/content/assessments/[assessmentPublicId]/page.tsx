import { AssessmentDetailClient } from "@/components/teacher-content/assessment-detail-client";

export default async function AssessmentDetailPage({
  params
}: {
  params: Promise<{ assessmentPublicId: string }>;
}) {
  const { assessmentPublicId } = await params;

  return <AssessmentDetailClient assessmentPublicId={assessmentPublicId} />;
}
