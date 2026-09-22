# MEDIA-002 — a dev stand-in for the GuardDuty verdict

## Why this exists

The human chose option (a) for dev media on 2026-09-22
([`TODO/03-open-decisions.md`](../../../TODO/03-open-decisions.md) §1): real
dev S3 buckets rather than an emulator, consistent with the earlier "real auth,
not a shortcut" decision. That answer included **"a dev-only script that runs
the processing pipeline on demand"**, and this is it.

The buckets are a human step and are written up in
[`TODO/02`](../../../TODO/02-deployment-requirements.md) §7. Creating them is
not enough on its own: **GuardDuty Malware Protection for S3 does not exist
locally**, so no scan verdict is ever emitted, so an uploaded object never
leaves `Quarantined`, so it can never be attached to a post. Compose-with-media
cannot be clicked through in a browser until something supplies that verdict.

## The one thing to get right

Criterion 6 is the important one: **reuse the pipeline, do not reimplement it.**

`backend/app/media/**` is in `forbidden_paths` deliberately. The temptation is
to write a two-line script that flips a status column, and that is the wrong
answer — it would drift from the real handler silently, and the browser
click-through it enables would be testing a path production never takes. Find
the code the real verdict handler calls and call the same thing. If that code
is not reachable from a script without changing `media/`, **escalate** rather
than widening scope: that is a design problem worth a human decision, not
something to work around.

## The safety requirement

Criterion 4 is not a formality. This script exists to bypass a security control
— the malware scan — so it must be structurally impossible to point at anything
but a developer's machine. Fail fast, refuse loudly, exit non-zero. Follow the
fail-fast guidance in
[`design-principles.md`](../../../wiki/CodeContext/Standards/design-principles.md)
and the baseline in
[`security.md`](../../../wiki/CodeContext/Standards/security.md).

"Refuses unless development" means an explicit positive check for a development
environment, not an absence of a production marker. A missing environment
variable must fail closed.

## Notes for the test agent

`backend/tests/media/` exists — read its siblings first. `moto` is available
for S3 and the suite already uses it; no real bucket should be touched by any
test. Criterion 5 (idempotency) and criterion 2 (already-processed) are close
but not the same: the first is about running twice, the second about a row that
arrived in that state by another route. Pin both.

## Notes for the code agent

`backend/scripts/` is a permitted location and `seed_dev.py` already lives
there — match its conventions, including the docstring style that states
plainly that it is dev fixture data and not the real loader. This script
deserves the same kind of docstring, and for the same reason: someone will find
it later and need to know instantly that it is a stand-in, not the pipeline.
