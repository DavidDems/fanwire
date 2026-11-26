# FRONTEND-060: the CDN cache limit in the delete-account dialog

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

USERS-009's warning-copy gate (`.ai/tasks/USERS-009/brief.md`): no stronger
erasure claim than the system keeps. The dialog says images are deleted and
backups expire within 7 days, which is true of S3 and RDS. But CloudFront's
`/media/*` behaviour uses `CACHING_OPTIMIZED`, whose default TTL is 24 hours,
and the media pipeline sets no `Cache-Control`, so an edge that cached an image
before deletion can serve it for up to a day. One sentence says so.

## Not switched on

Account deletion answers 503 while `ACCOUNT_LIFECYCLE_ENABLED` is off. This
unit changes copy only and is true whether deletion is on or off.

## Wording

Chosen by the Director in the human's place (track 6 decision log); the human
approves or overturns it on the track PR.
