# Classroom Acceptance and Intended-Use Validation

Status: implementation and evidence collection in progress. **Classroom
instructional validation remains open.** Engineering success does not establish pedagogical value,
psychometric validity, fairness, learning gains, or permission to make individual
consequential decisions. This protocol is not institutional or ethics approval.

## Intended use must be fixed first

The intended use is teacher-supervised formative classroom learning. Here,
"high risk" means that incorrect feedback or diagnosis could adversely affect
real students' learning, not that the application is being authorized to make
grading, admission or qualification decisions. Before evaluation, specify the
course/domain, population, language/accommodations, assessment version, permitted
resources, attempt policy, teacher monitoring and intervention. The v2 evidence
packet explicitly limits permitted use to `teacher_supervised_formative_classroom`.
If consequential scoring is later proposed, it needs a separate intended-use
argument, decision precision and review policy; this checklist does not authorize it.

The current flow reveals initial answers after submission and allows further
attempts. A later score therefore follows exposure and instruction; it is not an
independent baseline. Do not combine pre-feedback initial performance, assisted
reasoning, repeated-item recall, and independent transfer into one unqualified
mastery score. Freeze a defensible decision policy before evaluating it. A new
item version, grading policy, prompt or model requires an impact review and
revalidation of affected interpretations, not merely a fresh deployment.

## Three separate evidence layers

1. **Engineering:** authoritative state, scoring snapshots, persistence,
   permissions, retries, interruption recovery, browser behavior and export
   reconciliation. Deterministic substitutes are useful here.
2. **Pedagogical/diagnostic quality:** factual accuracy, actual claim coverage,
   evidence-grounded diagnoses, effective questions/scaffolds, calibrated
   uncertainty, appropriate closure, and no protected-answer leakage. Review
   actual live outputs against independently reviewed cases.
3. **Validity for classroom interpretation and action:** content and response-process
   evidence, correct interpretation of student stance, comparison with suitable
   independent evidence, fairness/accessibility, student burden, teacher
   intervention, consequences, and learning/transfer evidence appropriate to the specific
   pedagogical claim. Representative students and qualified human judgment are
   necessary; simulated learning is not evidence for real learning.

The AERA/APA/NCME *Standards for Educational and Psychological Testing* (2014),
Chapter 1, concerns support for specified score interpretations and uses, not a
blanket label of a valid system:
https://www.testingstandards.net/uploads/7/6/6/4/76643089/standards_2014edition.pdf

NIST AI RMF Core, MAP 2.3 and MEASURE, supports explicit construct validation,
repeatable testing and human oversight:
https://airc.nist.gov/airmf-resources/airmf/5-sec-core/

These references guide the protocol; they do not certify this application.

## Repeatable engineering run

Use a local PostgreSQL connection with permission to create disposable databases:

```sh
npm run classroom:acceptance
```

The runner creates randomly named local databases, applies existing migrations,
seeds synthetic records, then drops only databases it created. It never accepts
a remote database URL. Child tests block external HTTP and disable live AI. The
default run executes type/lint checks, the current classroom and navigation
suites, then a production build and browser login/progression, response-stage
data/export, and background-preparation tests. Build and test servers run
sequentially. Separate phases are `server` and `browser`; a phase pass is not a
full-run pass. Existing historical scripts are not counted as newly passed.

Artifacts are written to a new temporary directory. Each command has an exit
status, duration and log hash. The source hash includes current tracked and new
source/test scripts, configuration, and dependency manifests; it is checked at
the end. Editing these files while a run is active invalidates the run identity.
Generated production build output is not source input. A report explicitly leaves
live quality, classroom-scale load, independent review and student validation open.
Existing request-race or 30-student message-reservation tests are not full
30-student browser/provider classroom trials.

Tests must assert saved records and resulting state, not just reassuring text.
For each representative journey reconcile original response, immutable package,
profile input/output/source, conversation evidence, teacher view, and actual
downloaded research files. Preserve missing observations and failed calls.

## Bounded live diagnostic probe

```sh
RUN_ASSESSMENT_QUALITY_CANARY=true ASSESSMENT_QUALITY_MODEL=<explicit-model> npm run classroom:assessment-quality
```

This uses two banks of 12 synthetic cases in four sequential requests. Each bank
runs forward and reversed, at medium reasoning with a 16,000 output-token ceiling per
request. It sends no student records, changes no operational configuration and
writes no classroom database records. It stops on a provider failure, does not
silently add more requests, and retains failed results. It uses the current
initial planning/semantic-review prompt and schema, not the complete deployed
end-to-end formative agent. Provider-level retries, if any, are separate from
the four logical requests and must be included in a cost audit.

Reference expectations are **developer-proposed**, not expert-certified truth.
Correct choice with false reasoning, concise and plain-language correct answers,
multiple errors, uncertainty, untrusted instructions, scales, percentiles and
cross-test comparison are included. Label/count checks detect regressions but do
not establish that every misconception proposition is substantively correct.
Results retain case/prompt/configuration hashes, usage, order, outputs and pending
human-review status. Do not tune on these cases and call them an untouched test
set. A later validation set must be independently reviewed and held out.
The probe also invokes the application's student-message validator. A diagnostic
label/count pass alone is not a complete probe pass. Obvious unfinished endings
require repair; the check cannot establish grammatical or factual correctness.
The legacy initial-feedback presenter now preserves validated messages rather
than clipping them or adding generic praise. Existing historical messages remain
unchanged. Reviewers must still read the complete outputs.

## Independent review procedure

Two qualified reviewers independently review blinded cases before adjudication.
Record reviewer identity/role, conflicts, instructions, dates and individual
ratings; do not replace disagreements with consensus before reporting agreement.
The authoring model and a second model are not independent human reference
standards. Automated ratings may assist triage only.

For **items**, review construct/objective alignment, cognitive demand, one
defensible key, distractor plausibility, ambiguity, accessibility, assumed
background knowledge and sufficiency of coverage. Confirm imported source
meaning was not altered. Count of items alone is not a validity argument.

For **diagnoses**, link each asserted and each expected claim to the student's
actual evidence. Distinguish false-positive diagnosis, missed diagnosis,
unsupported resolution and appropriately withheld judgment. Correct option
selection does not cancel faulty reasoning; uncertainty is not a misconception;
omitting an explanation is not proof of a specific false belief.
The v4 initial-profile prompt and v3 semantic review distinguish the student's
stance, the proposition's correctness and the depth of evidence. Explicitly
endorsing an explanation supplied by an option is meaningful evidence, not
automatically mere repetition. Recognizing a supplied explanation is not
independent application. Rejecting or quoting a false proposition is not endorsing
it. See `STANCE_AWARE_REASONING.md` for variables, linking rules and limits.
Earlier stored diagnoses are not retroactively rewritten or made equivalent.

For **teaching**, review factual accuracy, response to the student's actual need,
coverage of distinct unresolved claims, burden, useful adaptation, protected-key
handling and the quality of new evidence elicited. Test partial correction,
requests for examples, copying, changing topics, repeated difficulty, pauses,
voluntary exit and maximum-turn closure. Explaining a concept or supplying a
worked answer does not demonstrate that the student can independently apply it.
Do not infer attention or misconduct from timing or navigation.

Use `docs/acceptance/reviewer-template.json` as a blank review record. Anchors are
0 = substantive failure; 1 = partial/uncertain evidence requiring follow-up;
2 = adequately supported for the stated criterion; null = not evaluated. A
critical failure cannot be averaged away by high scores on other dimensions.
Do not force every dimension to apply to every case.

## Measurements and reporting

- Diagnostic precision = TP / (TP + FP); recall = TP / (TP + FN), using
  adjudicated claim identities, not keyword overlap. A zero denominator is
  unavailable, not perfect performance. Report counts and abstentions alongside
  rates. Missed claims require a reference review of what should have been found.
- Report unsupported-resolution and premature-closure counts separately from
  syntax/provenance failures and provider failures.
- Report repeatability across repeats and order changes by case. Repeated calls
  on one case are not independent students. Use case/student-aware uncertainty
  estimates and report the sample size and sampling scheme.
- Human agreement uses independent pre-adjudication labels and an appropriate,
  prespecified statistic; document weighting and missing/not-applicable rules.
- Score precision and decision consistency depend on the actual assessment and
  target population. Do not substitute AI confidence, a model's self-rating, or
  a high alpha value for accuracy of an individual high-stakes decision.
- Learning claims require independent appropriately timed outcome/transfer
  evidence and a design addressing practice/exposure effects. A tutor's profile
  transition is not that independent outcome.
- Fairness/accessibility requires representative usage and relevant group/error
  comparisons with uncertainty. Do not infer demographic attributes from names
  or writing style, or collect sensitive attributes without an approved purpose.
- Freeze practical acceptance thresholds, sampling and critical-failure rules
  with the responsible experts before collecting the held-out evidence. This
  implementation does not invent universal numerical validity thresholds.

## Evidence gate and release discipline

`src/lib/evaluation/classroom-acceptance.ts` defines 11 evidence requirements.
The v2 classroom checklist replaces default cut-score/learning-gain/appeal gates
with response-process and stance interpretation, student experience and
instructional safety, and teacher review/intervention. This does not waive the
need for independent outcome evidence if learning-gain claims are made.
The checker rejects missing/duplicate evidence, wrong evidence types, changed
candidate identity or artifact hashes, dates before the criteria freeze or in
the future, unresolved critical issues, and absent independent review. A mock
pass cannot satisfy a live/expert/student-pilot requirement.

```sh
npm run classroom:acceptance:check -- packet.json current-identity.json evidence-directory
```

`AcceptanceIdentitySchema` binds source, assessment content, effective model
configuration, decision policy, intended use and population. Hashes and paths
must refer to real retained artifacts, including the frozen criteria file at
`criteria_artifact_path`. Relative artifact paths cannot escape the supplied
evidence directory, including through symlinks. The blank reviewer template is
not a completed acceptance packet and cannot produce a pass.

The best possible checker status is **ready_for_human_decision**, never a
scientific certificate; `high_stakes_authorized` always remains false. Reviewer
independence and conclusions require accountable human verification. This local
checklist is not tamper-proof authentication, not a production feature flag,
and is not currently wired to block Render deployments. Do not represent it as
an enforced production permission system.

Classroom use requires accountable teacher review of remaining instructional
risks, with manual fallback, incident monitoring and rollback. A software test
pass or deployment is not pedagogical approval. The compatibility field
`high_stakes_authorized: false` specifically avoids granting consequential-use
authorization and should not be read as an assertion that formative teaching is
low risk. Earlier run reports retain their original terminology and results.
