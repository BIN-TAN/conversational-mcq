# E2A.44 Classroom Pilot Data Architecture Protocol Freeze

## Status

E2A.44 is a deterministic, no-live protocol freeze for CBA classroom-pilot
workflow, data architecture, privacy, visibility, consent, anonymization, and
research-export reproducibility. It does not deploy a classroom pilot, collect
research data, call a provider, approve a candidate, or activate a candidate.

- Protocol version:
  `e2a44-classroom-pilot-data-architecture-freeze-v1`
- Protocol hash:
  `6818e181e5ecbd500afe2bb22d50e33edf56b39f788e0dfd31f406db34c25ea0`
- Composite runtime identity:
  `8eac47d0060a905fe6c94725af97ed62797481fae0cb3e4164405da3fa687c5f`
- Architecture layers: `5`
- Conceptual entities: `23`
- Workflow states: `7`
- Required regressions: `12`
- Deterministic checks: `83`
- Provider calls: `0`
- Network requests: `0`
- Classroom deployment authorized: `false`
- Research collection authorized: `false`
- Database schema modified: `false`
- Runtime intelligence modified: `false`
- Authoritative 34-artifact packet:
  `.data/e2a44-classroom-pilot-data-architecture-protocol-freeze/e2a44_20260725T174046126Z_72a2160c/`

## Protected Boundary

E2A.44 adds a conceptual pilot-architecture and deployment-rules layer over the
frozen E2A.43 empirical-study protocol. It does not modify Evaluator V5, the
tutor candidate, runtime architecture, evidence pipeline, learning profiles,
stopping policy, E2A.42 evaluation contracts, or E2A.43 research contracts.

The data architecture is a conceptual contract. It does not require or perform
a Prisma migration.

## Classroom Workflow

`classroom-workflow-contract-v1` defines seven bounded states:

1. pilot setup;
2. participant access;
3. research eligibility;
4. student assessment;
5. teacher review;
6. research export; and
7. withdrawal processing.

The application owns authoritative transitions. Student assessment remains
chat-native and application-governed. Research export fails closed unless the
study is authorized, affirmative consent is current, withdrawal has not
occurred, and the export scope is approved.

Course participation is independent of research consent. Missing, declined, or
withdrawn consent does not block ordinary course access and must not affect
grades.

## Five-Layer Data Architecture

`pilot-data-architecture-contract-v1` organizes the pilot around five layers.

### Assessment Object

- item;
- concept;
- objective;
- misconception target; and
- evidence requirements.

Administered item, objective, and diagnostic-context snapshots are versioned.
Mutable current content cannot replace the content actually administered.
Misconception targets remain candidate interpretations rather than confirmed
student states.

### Student Evidence

- response;
- confidence;
- distractor evidence;
- structured evidence;
- revision evidence; and
- transfer evidence.

Evidence records preserve source IDs, timestamps, accepted revisions, and
administered-item scope. Answer correctness, confidence, a selected distractor,
revision, or transfer response is bounded evidence and does not independently
prove broader understanding.

### Learning State Evolution

- append-only profile history;
- transitions;
- evidence-source provenance; and
- timestamps and sequence.

Profile snapshots are assessment-specific evidence summaries, not stable
learner traits. Every transition retains observable evidence sources and
versioned decision context. Server sequence is authoritative for ordering.

### Intervention

- strategy;
- targeted gap;
- observed outcome; and
- adaptation history.

Every strategy and adaptation is append-only and evidence-linked. Selection of
an intervention does not prove effectiveness, and temporal order alone does
not establish causality.

### Classroom and Research

- student;
- instructor;
- course; and
- research separation.

Operational identities and course records remain separate from pseudonymous
research IDs. Teacher course access does not automatically grant access to
identifiable research linkage data. Course membership does not imply research
consent.

## Research Data Boundary

`research-data-boundary-v1` separates:

1. course operations;
2. restricted identity linkage and consent records; and
3. pseudonymous research-analysis data.

Research exports may contain approved administered snapshots, student-authored
evidence, bounded process indicators, profile and intervention history,
revision evidence, and transfer evidence.

They must not contain:

- chain-of-thought;
- hidden model reasoning;
- hidden prompts;
- unnecessary internal metadata;
- provider secrets;
- password or access-code hashes; or
- direct identifiers.

Process indicators do not independently prove understanding, effort,
motivation, cheating, or misconduct.

## Teacher Visibility

`teacher-visibility-contract-v1` allows an authorized, course-scoped teacher to
review:

- evidence summaries;
- candidate misconception patterns;
- instructional-support information; and
- administered response and process summaries.

It disallows hidden model reasoning, hidden prompts, system internals, and
records outside the teacher's authorized course scope.

## Student Privacy

`student-privacy-contract-v1` allows the current student to see:

- feedback;
- next steps; and
- plain-language learning summaries.

It disallows internal ontology labels, raw profile fields, AI decision records,
other students' records, hidden prompts, and hidden reasoning. Internal
evidence states must be translated into concise student-safe language.

## Consent and Withdrawal

`consent-and-withdrawal-contract-v1` distinguishes `not_requested`, `pending`,
`consented`, `declined`, and `withdrawn`.

Missing or pending affirmative consent excludes a record from research export
and analysis without blocking course participation. Withdrawal stops future
research inclusion and applies the approved disposition policy without
affecting course access or grades. Re-consent requires a new affirmative
record.

This freeze does not assume REB approval and does not authorize consent
collection or research participation.

## Anonymization

`anonymization-contract-v1` requires a study-specific keyed HMAC-SHA-256 or
institutionally approved equivalent. The pseudonym mapping and key remain
outside the analysis export under designated-custodian access. The contract
also requires collision checks, free-text disclosure review, and small-cell
disclosure review.

Pseudonymization is not anonymity. The freeze specifies the boundary but does
not deploy an identity service or generate a production key.

## Reproducible Export

`data-export-reproducibility-contract-v1` requires:

- protocol, schema, query/service, consent, and anonymization versions;
- source snapshot cutoff;
- application commit and active configuration hash;
- included and excluded record counts;
- stable column and record ordering;
- explicit null and timestamp rules;
- per-file SHA-256 values; and
- one canonical export hash.

Given the same source snapshot and versions, reordered inputs produce the same
canonical hash. Generated-at metadata is excluded from the canonical hash.
Profile, intervention, revision, and transfer histories remain included.

## Deterministic Regressions

The freeze covers the twelve requested cases:

1. consent missing;
2. withdrawal;
3. anonymization;
4. grade-linkage separation;
5. teacher visibility;
6. student visibility;
7. evidence preservation;
8. profile history;
9. intervention history;
10. transfer history;
11. multi-student isolation; and
12. export reproducibility.

All records are synthetic. No real student data are used.

## Frozen Budget

The protocol-freeze budget is zero provider calls and zero network requests.
Future classroom operations, research storage, and participant compensation
budgets are intentionally not estimated; those require institutional and REB
review. E2A.44 has no live entrypoint.

## Commands

Generate a read-only protocol packet:

```bash
npm run eval:formative:e2a44:run
```

Inspect the latest packet:

```bash
npm run eval:formative:e2a44:report
```

Run all deterministic checks:

```bash
npm run eval:formative:e2a44:smoke
```

Focused commands cover workflow, architecture, research boundaries, teacher and
student visibility, consent and withdrawal, anonymization, export
reproducibility, evidence histories, multi-student isolation, privacy, replay,
regressions, historical integrity, budget, protected components, artifacts,
and the provider-call guard.

## Interpretation Boundary

Passing E2A.44 means the conceptual contracts, deterministic boundary tests,
and immutable artifact package are internally consistent. It does not mean a
classroom deployment, REB approval, consent process, production anonymization
service, data migration, or empirical research export has occurred. Those
steps require separate institutional approval, implementation review, security
review, and explicit authorization.
