import { ItemDesignClient } from "@/components/teacher-content/item-design-client";

export default async function AssessmentItemDesignPage({
  params
}: {
  params: Promise<{ assessmentPublicId: string }>;
}) {
  const { assessmentPublicId } = await params;
  return <ItemDesignClient assessmentPublicId={assessmentPublicId} />;
}
