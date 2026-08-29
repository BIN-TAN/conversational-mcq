import { McqImportClient } from "@/components/teacher-content/mcq-import-client";

export default async function ImportMcqItemsPage({
  params,
  searchParams
}: {
  params: Promise<{ assessmentPublicId: string }>;
  searchParams: Promise<{ batch?: string }>;
}) {
  const { assessmentPublicId } = await params;
  const { batch } = await searchParams;

  return <McqImportClient assessmentPublicId={assessmentPublicId} initialBatchPublicId={batch ?? null} />;
}
