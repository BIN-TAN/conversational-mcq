import * as XLSX from "xlsx";
import { requireTeacherResearcher } from "@/lib/services/content/api";
import sample from "../../../../../../../public/samples/mini-test-import.json";

export async function GET() {
  const auth = await requireTeacherResearcher();
  if (!auth.ok) return auth.response;
  const workbook = XLSX.utils.book_new();
  const rows = sample.items.map((item, index) => ({
    item_label: `Example-${index + 1}`, stem: item.stem,
    ...Object.fromEntries(item.options.map(option => [`option_${option.label.toLowerCase()}`, option.text])),
    key: item.key, target_reasoning_note: item.target_reasoning_note,
    strong_reasoning_should_mention: item.strong_reasoning_should_mention,
    distractor_diagnostic_notes: item.distractor_diagnostic_notes, source_attribution: item.source_reference
  }));
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
