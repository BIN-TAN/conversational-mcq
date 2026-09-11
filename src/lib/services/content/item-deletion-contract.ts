export const MAX_ITEM_BATCH_DELETION = 100;

export type ItemDeletionPreview = {
  assessment_public_id: string;
  items: Array<{ item_public_id: string; item_order: number; item_stem: string }>;
  selection_fingerprint: string;
  required_delete_confirmation: string;
  remaining_item_count: number;
  remaining_included_item_count: number;
};

export type ItemDeletionResult = {
  deleted_item_public_ids: string[];
  deletion_operation_public_id: string;
};
