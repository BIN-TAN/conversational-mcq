import { ConceptUnitDetailClient } from "@/components/teacher-content/concept-unit-detail-client";

export default async function ConceptUnitDetailPage({
  params
}: {
  params: Promise<{ conceptUnitPublicId: string }>;
}) {
  const { conceptUnitPublicId } = await params;

  return <ConceptUnitDetailClient conceptUnitPublicId={conceptUnitPublicId} />;
}
