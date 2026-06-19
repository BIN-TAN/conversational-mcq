import { ItemEditorClient } from "@/components/teacher-content/item-editor-client";

export default async function NewItemPage({
  params
}: {
  params: Promise<{ conceptUnitPublicId: string }>;
}) {
  const { conceptUnitPublicId } = await params;

  return <ItemEditorClient conceptUnitPublicId={conceptUnitPublicId} mode="create" />;
}
