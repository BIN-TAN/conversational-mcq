import { ItemEditorClient } from "@/components/teacher-content/item-editor-client";

export default async function ItemDetailPage({
  params
}: {
  params: Promise<{ itemPublicId: string }>;
}) {
  const { itemPublicId } = await params;

  return <ItemEditorClient itemPublicId={itemPublicId} mode="edit" />;
}
