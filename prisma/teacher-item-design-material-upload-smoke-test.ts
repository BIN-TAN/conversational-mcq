import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { projectConceptAdministrationRulesForStudentAgents } from "../src/lib/services/content/item-design-provider-boundary";
import { ItemDesignAssistantOutputSchema } from "../src/lib/services/content/item-design-contract";
import {
  ITEM_DESIGN_MAX_ATTACHMENTS,
  prepareItemDesignMaterials
} from "../src/lib/services/content/item-design-materials";
import { compileItemDesignMultimodalRequestBody } from "../src/lib/services/content/item-design-multimodal-provider";

async function docxBytes() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Course evidence about reliability and validity.</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
  const docx = await docxBytes();
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii");
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("synthetic-image-content", "ascii")
  ]);
  const prepared = await prepareItemDesignMaterials({
    client_message_id: "material_upload_smoke_message",
    files: [
      {
        file_name: "course-notes.docx",
        media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: docx
      },
      { file_name: "course-reading.pdf", media_type: "application/pdf", bytes: pdf },
      { file_name: "lecture-slide.png", media_type: "image/png", bytes: png }
    ]
  });
  assert.equal(prepared.length, 3);
  assert.match(prepared[0]?.extracted_text ?? "", /reliability and validity/);
  assert.equal(prepared[0]?.provider_attachment, null);
  assert.equal(prepared[1]?.provider_attachment?.kind, "pdf");
  assert.equal(prepared[2]?.provider_attachment?.kind, "image");

  const request = {
    agent_name: "mcq_diagnostic_authoring_assistant_agent",
    model_config: { model_name: "deterministic-no-provider", max_output_tokens: 1000 },
    instructions: "Teacher-only multimodal request compilation smoke.",
    input: {
      current_source_materials: prepared.map((material) => ({
        material_id: material.material_id,
        file_name: material.file_name
      }))
    },
    output_schema: ItemDesignAssistantOutputSchema,
    schema_name: "item_design_material_upload_smoke",
    client_request_id: "material_upload_smoke_request",
    timeout_ms: 10_000,
    metadata: { purpose: "no_provider_material_compilation_smoke" }
  };
  const body = compileItemDesignMultimodalRequestBody({
    request,
    attachments: prepared.flatMap((material) =>
      material.provider_attachment ? [material.provider_attachment] : []
    )
  });
  const input = body.input as unknown as Array<{ content: Array<Record<string, unknown>> }>;
  const content = input[0]?.content ?? [];
  assert.equal(content.filter((entry) => entry.type === "input_file").length, 1);
  assert.equal(content.filter((entry) => entry.type === "input_image").length, 1);
  assert.match(String(content.find((entry) => entry.type === "input_file")?.file_data), /^data:application\/pdf;base64,/);
  assert.match(String(content.find((entry) => entry.type === "input_image")?.image_url), /^data:image\/png;base64,/);
  assert.equal(body.store, false);

  await assert.rejects(
    () => prepareItemDesignMaterials({
      client_message_id: "invalid_image_message",
      files: [{ file_name: "fake.png", media_type: "image/png", bytes: Buffer.from("not-an-image") }]
    }),
    /not a valid PNG, JPEG, or WebP image/
  );
  await assert.rejects(
    () => prepareItemDesignMaterials({
      client_message_id: "too_many_files_message",
      files: Array.from({ length: ITEM_DESIGN_MAX_ATTACHMENTS + 1 }, (_, index) => ({
        file_name: `reading-${index}.pdf`,
        media_type: "application/pdf",
        bytes: pdf
      }))
    }),
    /Attach no more than/
  );

  const studentRules = projectConceptAdministrationRulesForStudentAgents({
    item_design_blueprint: {
      schema_version: "evidence-centered-item-design-v1",
      section_topic: "Measurement",
      section_summary: "Measurement evidence",
      objectives: [],
      misconception_hypotheses: [],
      exemplar_items: [],
      generation_settings: {
        target_item_count: 6,
        option_count: 4,
        difficulty_mix: ["application"],
        context_notes: "Teacher only"
      }
    },
    item_design_source_materials: {
      schema_version: "evidence-centered-item-design-source-materials-v1",
      materials: [{
        material_id: "material_private",
        file_name: "private-course-source.pdf",
        extracted_text: "Unadministered answer key is B.",
        content_summary: "Teacher-only source summary."
      }]
    }
  });
  const studentRulesText = JSON.stringify(studentRules);
  assert.doesNotMatch(studentRulesText, /private-course-source/);
  assert.doesNotMatch(studentRulesText, /Unadministered answer key/);
  assert.doesNotMatch(studentRulesText, /Teacher-only source summary/);

  const root = process.cwd();
  const uiSource = readFileSync(
    path.join(root, "src/components/teacher-content/item-design-client.tsx"),
    "utf8"
  );
  const routeSource = readFileSync(
    path.join(root, "src/app/api/teacher/assessments/[assessmentPublicId]/item-design/assistant/route.ts"),
    "utf8"
  );
  assert.match(uiSource, /Add PDF, Word, or images/);
  assert.match(uiSource, /multiple/);
  assert.match(routeSource, /request\.formData\(\)/);
  assert.match(routeSource, /Buffer\.from\(await file\.arrayBuffer\(\)\)/);

  console.log(JSON.stringify({
    status: "passed",
    prepared_materials: prepared.length,
    pdf_inputs: 1,
    image_inputs: 1,
    provider_calls: 0,
    network_requests: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
