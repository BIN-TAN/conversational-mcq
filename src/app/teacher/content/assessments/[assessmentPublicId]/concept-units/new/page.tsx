import { ConceptUnitCreateClient } from "@/components/teacher-content/concept-unit-form-client";

export default async function NewConceptUnitPage({
  params
}: {
  params: Promise<{ assessmentPublicId: string }>;
}) {
  const { assessmentPublicId } = await params;

  return <ConceptUnitCreateClient assessmentPublicId={assessmentPublicId} />;
}
