import { ItemDesignClient } from "@/components/teacher-content/item-design-client";

export default async function AssessmentItemDesignPage({
  params,
  searchParams
}: {
  params: Promise<{ assessmentPublicId: string }>;
  searchParams: Promise<{ view?: string; prepare?: string }>;
}) {
  const { assessmentPublicId } = await params;
  const { view, prepare } = await searchParams;
  return (
    <ItemDesignClient
      assessmentPublicId={assessmentPublicId}
      autoPrepareTopic={prepare === "topic"}
      initialView={view === "review" ? "review" : "assistant"}
    />
  );
}
