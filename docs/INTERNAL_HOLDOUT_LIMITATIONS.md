# Internal Holdout Limitations

The Phase 7E2B `internal_holdout` stratum uses synthetic cases created during
Phase 7E1 and not used in the 25-item canary. It helps test whether the canary
result generalizes across the remaining synthetic fixture space.

It is still an internal holdout:

- cases come from the same project-owned synthetic fixture design
- cases are not real classroom data
- cases are not deidentified student data
- cases are not independently authored external validation samples
- summative outcomes are not used

The full-pilot report therefore labels the primary section as internal holdout
and sets `classroom_validity=false`. Passing the pilot can support a decision to
consider controlled operational integration, but it does not validate research
claims about classroom outcomes or student learning.
