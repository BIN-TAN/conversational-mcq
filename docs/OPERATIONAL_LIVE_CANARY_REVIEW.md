# Operational Live Canary Review

After a future paid canary run completes, export a blind review packet:

```bash
npm run operational:live-canary:review-export -- --run <run_public_id>
```

Generated files are ignored under:

```text
.data/operational-live-canary/<run_public_id>/review/
```

Files:

- `blind_review_packet.jsonl`
- `review_reference.jsonl`
- `annotation_template.csv`

The blind packet is designed for expert review of effective operational behavior. It includes synthetic input/workflow context, effective student-facing messages, effective structured results, effective workflow actions, item-verification findings, rubric criteria, and safety expectations.

The blind packet hides:

- scenario IDs
- persona labels
- raw provider failure status
- fallback or canonicalization labels
- model/provider names
- prompt metadata
- token use and cost
- automated flags
- gold labels

The reference file keeps adjudication metadata separate from the blind packet.

Later AI-assisted review may be imported with this provenance:

```text
annotation_source=ai_agent_review
annotation_status=ai_confirmed
review_target=operational_effective_output
reviewer_model=gpt-5.5-pro
review_method=blind_review
```

AI review is not human confirmation. A Phase 8C all-pass AI review remains provisional engineering evidence only.
