# Global initial feedback allowance and failure recovery

This release supersedes the single-student/test allowance described in
`PROFILING_APPROVAL_REPAIR_2026-09-27.md`. The new approved runtime policy applies
30,000 output tokens to initial-feedback generation for every student and test,
including existing attempts when they make a new call or retry. Historical calls
keep their original limits. It does not enlarge later conversation, canonical
profiling, teacher-authoring, daily spending or input-context limits.

The application selects the allowance before reserving the AgentCall and sending
the provider request. The shared approval replaces individual grants and is
included in the runtime hash; mixed global/individual configurations are rejected.
`prisma/global-feedback-budget-amend.ts` creates a new immutable operator-authorized
amendment from the verified scoped parent, with synthetic 3/12-item capacity
evidence. Only this policy changes. Models, prompt hashes, validators, reasoning
effort and 90-second request timeout stay unchanged. This does not claim a new
independent pedagogical review. Keep the parent approval for provenance/rollback.

Students can retry a failed preparation or contact their teacher for help. The
failure screen no longer offers End attempt, including its header control;
Pause and leave keeps the attempt resumable without consuming another chance.
No teacher notification is sent automatically. There is no continue-without-feedback
control or backend bypass. The retired endpoint requires authentication and
returns 410 without mutation. Ordinary explicit ending elsewhere preserves all
evidence and closes the attempt as student-ended with incomplete support; it
does not start the next topic, manufacture a completion time or refund a chance.
The teacher can restore a chance for a technical issue through existing controls.
Transient errors retain bounded retries; output-capacity failure stops automatic
repeats. A larger ceiling cannot guarantee completion or eliminate outages.

See DATA_LOGGING_SPEC.md for the new termination event and research projection.
Old continuation records are still readable and exportable without relabeling.
Verification and exact live-deployment evidence belong in the release ledger.
