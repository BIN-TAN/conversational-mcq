# Evaluation Stability Analysis

Phase 7E2B computes development stability metrics from the two repetitions of
each synthetic pilot base case. These are engineering metrics, not inter-rater
reliability and not classroom validity.

The pilot groups run items by `paired_case_key`. Each group should have exactly
two outputs: repetition 1 and repetition 2. Metrics include:

- core categorical agreement by agent
- paired human pass/fail agreement
- paired overall-rating mean absolute difference
- paired critical-failure agreement
- paired rubric-score mean absolute difference
- paired output count with confirmed critical failures

Agent-specific core comparisons are based on fields that should remain stable
for equivalent synthetic input, such as verification status, recognized intent,
profile labels, formative value, or follow-up action type.

The readiness gate requires:

- paired human pass/fail agreement at least 90%
- core categorical agreement at least 80% for each agent
- no paired output with confirmed critical failure

These gates are conservative development checks. Failure does not automatically
change prompts, schemas, or model choice.
