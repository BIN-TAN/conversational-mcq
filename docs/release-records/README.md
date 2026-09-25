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

Use the document skill and resolve the bundled Python and renderer through
`load_workspace_dependencies`. Python needs `python-docx`. No package install or
application dependency change is required. From the repository root:

```sh
"$DOCX_PYTHON" scripts/build-change-record.py
"$DOCX_PYTHON" scripts/build-change-record.py --check
"$DOCX_PYTHON" scripts/test-change-record.py
"$DOCX_PYTHON" "$DOCUMENT_SKILL/render_docx.py" \
  docs/release-records/Conversational_MCQ_Change_and_Deployment_Record.docx \
  --output_dir /private/tmp/cmcq-change-record-render --emit_pdf
```

Inspect every rendered PNG. QA images and PDFs stay outside the repository.
For the bundled macOS renderer, explicitly set `FONTCONFIG_FILE` to the bundled
`dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fontconfig/fonts.conf`
if Chinese glyphs are absent. Resolve the dependencies root from the loader;
do not install or switch to a desktop LibreOffice. The report uses Hiragino
Sans GB for Chinese and Arial for Latin text. Verify the actual render rather
than assuming successful conversion means the fonts rendered.
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
