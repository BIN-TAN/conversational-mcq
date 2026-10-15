# Change and deployment record

The fixed report file is `Conversational_MCQ_Change_and_Deployment_Record.docx`.
Its editable source is `releases.json`. Keep both under version control. The
ledger records application commits separately from later documentation commits.
Do not edit the generated Word file directly; changes would be lost on rebuild.

## After each application release

1. Append a stable record ID and the exact application commit. Describe observed
   defects, systemic changes, affected areas, and implications for teaching and
   research. Do not claim a hypothesis was a proven defect.
2. Record the actual verification commands, outcomes, test scope, failures,
   retries, remaining warnings, and whether real or synthetic records were used.
3. Verify push separately. Verify the canonical Render deployment's exact source
   commit and Live status, health/schema readiness, and preparation worker when
   relevant. Record verification time, deployment ID, and evidence source. If
   blocked, record pending/failed status rather than success.
4. Describe raw-data preservation, changed derivations, version fields, migration
   effects, historical missingness, and limitations. Do not retroactively label
   old records as collected by new instrumentation.
5. Update `updated_at` with an ISO timestamp, rebuild, validate, render the Word
   file, and visually inspect every page. Append corrections transparently.
6. Commit/push the ledger and Word file when authorized. A record-only follow-up
   does not require redeploying unchanged application code or documenting its own
   commit recursively. If it triggers a real deployment, verify it separately;
   do not silently substitute a documentation SHA for the recorded code release.

Never store passwords, tokens, database URLs, student names, or raw identifiable
student responses in these files. Test summaries must be safe to commit.
The Word is a technical change record, not evidence of learning gain or complete
psychometric validity. Older commit titles are an index, not verified deploys.

## Rebuild and check

Use the current documents skill and call `load_workspace_dependencies` to resolve
the bundled Python and Node executables. The Windows bundle provides `python-docx`,
`pdf2image`, Pillow and Poppler. It does not provide LibreOffice. This workstation
uses the verified official LibreOffice 26.2.6 runtime extracted under
`.data/windows-tools/libreoffice-26.2.6/runtime/program`; do not substitute a user's
desktop installation. No application dependency change is required.

The following PowerShell commands match the verified Windows runtime
`26.1013.11914`. If the loader or skills catalog reports a different location,
use those returned absolute paths instead. Run from the repository root after
the ledger contains the actual application commit and deployment evidence:

```powershell
$dependencyRoot = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
$docxPython = Join-Path $dependencyRoot 'python/python.exe'
$artifactNode = Join-Path $dependencyRoot 'node/bin/node.exe'
$documentSkill = Join-Path $env:USERPROFILE '.codex/plugins/cache/openai-primary-runtime/documents/26.1013.11914/skills/documents'
$officeBin = (Resolve-Path -LiteralPath '.data/windows-tools/libreoffice-26.2.6/runtime/program').Path
$popplerBin = Join-Path $dependencyRoot 'native/poppler/Library/bin'
$env:PATH = "$officeBin;$popplerBin;$env:PATH"

# Run once immediately before the first Word-authoring command for this update.
& $artifactNode "$documentSkill/container_tools/mark_artifact_operation_started.mjs" --operation-kind edit --expected-output-count 1 --output-format docx
& $docxPython scripts/build-change-record.py
& $docxPython scripts/build-change-record.py --check
& $docxPython scripts/test-change-record.py
& $docxPython "$documentSkill/render_docx.py" `
  docs/release-records/Conversational_MCQ_Change_and_Deployment_Record.docx `
  --output_dir .data/release-record-render --emit_pdf
```

Stop and resolve any nonzero command result before proceeding. Inspect every
rendered PNG at readable size, including all historical entries. QA images and
PDFs stay in ignored `.data`, outside the committed record. The report uses
Microsoft YaHei for Chinese and Arial for Latin text; both are installed on the
Windows workstation. Inspect bold Chinese labels as well as normal paragraphs:
successful conversion alone does not establish that all glyphs rendered.

Scoped `.gitattributes` entries require LF line endings for `releases.json` and
`scripts/build-change-record.py`. Preserve LF when updating the ledger. These
exact bytes form the source fingerprint, so a Windows editor changing them to
CRLF would produce a false stale-artifact failure. The focused tests enforce LF;
historical release content must remain unchanged when normalizing line endings.
`--check` checks source identity and essential content, not visual quality.
The source hash is stored in Word metadata. Output ZIP metadata is normalized
so unchanged source and generator inputs produce the same file in this runtime.
The generator never pushes, deploys, modifies the database, or uses the network.

The canonical service uses On Commit auto-deploy. For a genuinely record-only
follow-up commit, use `[skip render]` in the message to avoid restarting unchanged
application code. Never use it to bypass a requested application deployment.
Render documents this behavior at https://render.com/docs/deploys#skipping-an-auto-deploy.

## Initial record scope

The September 25 classroom-feedback release is detailed. The September 22
navigation/research fixes are included as a retrospective baseline, with their
evidence source and limits identified. September 11-15 commit titles provide
background only; they are not a claim that every historical deployment was
re-audited. Operational verification in this record is time-specific.
