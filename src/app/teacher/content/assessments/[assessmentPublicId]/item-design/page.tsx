import { ItemDesignClient } from "@/components/teacher-content/item-design-client";

export default async function AssessmentItemDesignPage({
  params,
  searchParams
}: {
  params: Promise<{ assessmentPublicId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { assessmentPublicId } = await params;
  const { view } = await searchParams;
  return <ItemDesignClient assessmentPublicId={assessmentPublicId} initialView={view === "review" ? "review" : "assistant"} />;
}
