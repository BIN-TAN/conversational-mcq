import * as XLSX from "xlsx";
import { requireTeacherResearcher } from "@/lib/services/content/api";
import sample from "../../../../../../../public/samples/mini-test-import.json";

export async function GET() {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  const workbook = XLSX.utils.book_new();
  // One column per incorrect option for "why a student might choose it" (rationale_x) and
  // an optional idea label (idea_label_x); essential elements one per line.
  const rows = sample.items.map((item, index) => {
    const rationales: Record<string, string | undefined> = item.distractor_rationales;
    const ideaLabels: Record<string, string | undefined> = item.idea_labels;
    return {
      item_label: `Example-${index + 1}`, stem: item.stem,
      ...Object.fromEntries(item.options.map(option => [`option_${option.label.toLowerCase()}`, option.text])),
      key: item.key, target_reasoning_note: item.target_reasoning_note,
      essential_elements: item.essential_elements.join("\n"),
      ...Object.fromEntries(item.options.flatMap(option => {
        const label = option.label.toLowerCase();
        return [[`rationale_${label}`, rationales[option.label] ?? ""], [`idea_label_${label}`, ideaLabels[option.label] ?? ""]];
      })),
      source_attribution: item.source_reference
    };
  });
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Example mini test");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Diagnostic guide"], ["Item ID", "Learning objective"],
    ...sample.items.map((item, index) => [`Example-${index + 1}`,
      sample.design.objectives.filter(objective => (item.objective_ids as string[]).includes(objective.objective_id)).map(objective => objective.statement).join("\n")])
  ]), "Diagnostic guide");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="mini-test-import.xlsx"', "Cache-Control": "no-store"
  } });
}
