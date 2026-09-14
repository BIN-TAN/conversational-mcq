export const WORKBOOK_MAX_BYTES = 2_000_000;
export type WorkbookGuide = { sheet_name: string; rows: Array<{ row: number; cells: string[] }> };
export type WorkbookPreview = {
  checksum: string;
  sheets: Array<{ sheet_name: string; item_count: number; supplied_keys: number; item_labels: string[] }>;
  guides: WorkbookGuide[];
  warnings: string[];
};
export type WorkbookStageResult = { tests: Array<{
  sheet_name: string; item_count: number; assessment_public_id: string;
  batch_public_id: string; review_url: string; reused: boolean;
}> };
