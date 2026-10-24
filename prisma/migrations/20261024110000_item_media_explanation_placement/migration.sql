-- Release CMCQ-20261024-11: item media can be shown with the item's explanation (answer review).
-- Adds one enum value; existing rows (item_stem, option) are unchanged.
ALTER TYPE "ItemMediaPlacement" ADD VALUE IF NOT EXISTS 'explanation';
