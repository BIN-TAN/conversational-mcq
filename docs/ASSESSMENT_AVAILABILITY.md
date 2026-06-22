# Assessment Availability

Phase 6D2A adds optional release and closing dates for new assessment starts.

## Timezone

- `COURSE_TIMEZONE` defaults to `America/Edmonton`.
- The value must be a valid IANA timezone.
- Database timestamps are stored as UTC `TIMESTAMPTZ`.
- Teacher date/time inputs are interpreted in the course timezone.
- Student messages display course-local dates and times.
- Do not use fixed UTC offsets for daylight-saving behavior.
- Do not expose an authoritative `NEXT_PUBLIC_*` timezone.

## Fields

`assessments.release_at`:

- nullable
- null means available immediately after publishing

`assessments.close_at`:

- nullable
- null means no closing date

When both are present, `close_at` must be after `release_at`.

## Availability States

The backend computes:

- `draft`
- `archived`
- `not_released`
- `open`
- `closed_to_new_starts`
- `invalid_content`

The student-safe availability response includes public assessment ID, title, description, availability state, course-local release/close strings, timezone, existing session public ID/status, and `can_start`/`can_resume`.

## Policy

Phase 6D2A uses:

```text
block_new_starts_allow_resume
```

Release and closing dates control new starts only. Students who already started may continue after the closing date. Closing does not terminate, expire, submit, grade, or invalidate a session.

There is no countdown timer and no time limit in Phase 6D2A.

## Student Messages

Examples:

- Not released: `This assessment will be available on [course local date and time].`
- Closed without an existing session: `This assessment is closed to new starts.`
- Closed with an existing resumable session: `The assessment is closed to new starts, but you may continue your existing session.`

Students do not see UTC as the primary display.

## Verification

Run:

```bash
npm run assessment:availability-smoke
```

The smoke test verifies open assessments, future release blocking, closed-to-new-starts blocking, invalid release/close windows, course timezone strings, and resume-after-close behavior.
