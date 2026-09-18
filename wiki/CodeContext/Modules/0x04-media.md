# 0x04 — Media

**Agent-facing.** Current-state only — see [[wiki/GeneralContext/index|index]] for how this wiki is organized. Read [[0x00-architecture]] first for the module map and the pipeline's place in the overall topology; this file details the `Media` entity and pipeline, it does not repeat the topology diagram.

`media/` is the highest-risk module in the app: it is the only place the backend accepts untrusted binary data from a client. Every rule below exists to bound that risk.

## Schema — `Media`

| Field | Type | Notes |
|---|---|---|
| `id` | PK | |
| `uploader_id` | FK → `User.id` | Required. See [[0x01-users]]. |
| `post_id` | FK → `Post.id`, nullable | Null while uploaded-but-unattached (compose flow uploads before the post is created) and for a profile-picture use (see [[0x01-users]]); set once attached to a post (see [[0x03-posts]]). |
| `s3_key_quarantine` | string, nullable | Key in the private quarantine bucket. Present from `Uploaded` through `Scanning`; cleared once the object is deleted post-processing (see Open decisions). |
| `s3_key_public` | string, nullable | Key in the public media bucket. Null until `Processed`. |
| `s3_key_thumbnail` | string, nullable | Key in the public media bucket. Null until `Processed`. |
| `mime_type` | string | The **verified** type from opening/parsing the file in the processing Lambda, never the client-declared `Content-Type` or file extension. |
| `size_bytes` | integer | Original upload size, capped at ~5MB (see AWS mapping below). |
| `status` | enum (State) | `Uploaded → Scanning → Processed \| Rejected`. See GoF tie-in below. |
| `created_at` / `updated_at` | timestamp | |

`Media` is RDS-tracked (system of record, per [[0x00-architecture]]) even though the bytes themselves live in S3 — the row is the only place that links a `User`, an optional `Post`, and the object's current pipeline state.

`post_id` is currently a plain column with no enforced FK constraint — `posts/`'s `Post` table doesn't exist yet in this branch. Same deferred-FK precedent as `User.profile_picture_media_id` → `Media.id` (see [[0x01-users]]): the real `ForeignKey("posts.id")` constraint gets added once `posts/`'s `Post` table lands in Phase 2.

## Design principles applied

Per [[wiki/CodeContext/Standards/design-principles|Design principles]]:
- **Fail fast** — a MIME mismatch, oversized file, or malformed image fails the pipeline step immediately (`Rejected`); nothing partially-valid is passed downstream.
- **Idempotency** — the presigned upload and the S3-event-triggered processing Lambda must both tolerate a retried upload (e.g. client retries after a timeout) without producing duplicate `Media` rows or double-processing the same object.
- **Explicit over implicit** — `status` is a first-class state field driving behavior (see State pattern below), not inferred from the presence/absence of S3 keys or timestamps.
- **Validate at boundaries only** — the boundary here is the S3 upload event and the processing Lambda's own parse step, not the client's declared type; everything after `Processed` is trusted internally.
- **Single Responsibility** — `media/` only validates, scans, and serves images; it never reasons about which post an image belongs to (that's `posts/`, via ID only, per the connection rule in [[0x00-architecture]]).

## GoF pattern tie-in

Per [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]]:
- **State** — `Media.status` (`Uploaded → Scanning → Processed/Rejected`) is a State object per status, not an `if`/`enum`-branch scattered across the codebase. `PublishPostFacade` (see [[0x03-posts]]) can only attach `Processed` media to a `Post` because the type/interface exposed to `posts/` makes a non-`Processed` `Media` un-attachable by construction, not by a runtime check.
- **Template Method** — the upload pipeline is the same skeleton shape as `AbstractEventIngestionPipeline` (see [[0x00-architecture]] "Ingestion & processing pipelines"): `validateType → scanForMalware → stripMetadata → generateVariants → publish`. Each step can halt/reject; no step is optional or reorderable per upload.

## AWS service mapping

Full stack rationale in [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] ("Media uploads"); mapping here is specific to `Media`:

| Step | Service | RDS-tracked? |
|---|---|---|
| Presigned upload URL issuance | Lambda (FastAPI/Mangum route) | `Media` row created at `Uploaded`, RDS-tracked |
| Upload target | S3 **quarantine bucket** (private, never behind CloudFront) | S3-only — object existence isn't independently tracked beyond `s3_key_quarantine` |
| Malware scan | **GuardDuty Malware Protection for S3**, triggered on quarantine bucket upload | Status transition to `Scanning` is RDS-tracked; the scan verdict itself is a GuardDuty finding, not stored on `Media` beyond pass/fail driving the next transition |
| Type verification, EXIF strip, variant generation | Processing **Lambda (Pillow)**, triggered by the S3 event after scan passes | Drives `status → Processed` or `Rejected`, RDS-tracked |
| Serving | S3 **public media bucket** + **CloudFront** | `s3_key_public` / `s3_key_thumbnail` RDS-tracked; CloudFront serves the public bucket only, never the quarantine bucket |

The quarantine bucket is intentionally **not** the one CloudFront serves — only the public bucket is reachable from the edge, per [[wiki/CodeContext/Standards/security|Security]] "CloudFront is the only public entry point."

## Security requirements

Per [[wiki/CodeContext/Standards/security|Security]] "User-generated content" and [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] "Media uploads" — treat all of these as hard gates, not defaults to tune later:
- **MIME allow-list**: `image/jpeg`, `image/png`, `image/webp` only. Everything else rejected, explicitly including SVG (can carry executable/script content).
- **Size cap**: ~5MB per image, enforced by the presigned URL's scoped policy — stricter than any other upload path in the app.
- **Quarantine isolation**: every upload lands in a private bucket never reachable via CloudFront and never public, regardless of scan outcome timing.
- **No trust in client-declared type**: the processing Lambda determines real file type by opening/parsing the image with Pillow; the client's `Content-Type` header and file extension are never authoritative.
- **EXIF stripping**: metadata (notably GPS) is stripped from every processed image before it reaches the public bucket.
- **Malware scanning**: GuardDuty Malware Protection for S3 scans every object before the processing Lambda treats it as trusted input; nothing reaches processing, let alone the public bucket, unscanned.
- **Fail-closed cleanup**: anything failing scan or validation is deleted outright, never retained "for review."
- **Per-user rate limiting**: uploads are rate-limited the same way posts are (API Gateway usage plan + app-level check), independent of the malware question — an open upload endpoint is a storage-cost/abuse vector on its own.

## Open decisions

Not yet decided — flag rather than assume when implementing:
- Retention/cleanup policy for quarantine objects that fail scan or validation — deleted immediately, per [[wiki/CodeContext/Standards/aws-stack|AWS Stack]], but the exact deletion trigger (Lambda-driven vs. a bucket lifecycle rule as a backstop) isn't specified.
- Retention for `Media` rows left permanently `Uploaded`/unattached (e.g. a user who uploads in the compose flow but never publishes the post) — no orphan-cleanup job is defined yet.

## API routes (Phase 2a)
Phase 1 built the `Media` model/State pipeline as pure Python with no FastAPI routes; Phase 2a (`wiki/GeneralContext/Prompts/phase-2-manager-agent.md`) added the minimum needed for the compose flow to actually start an upload. Routes live in `app.media.routes` (`APIRouter(prefix="/media")`), both protected by `get_current_user` (`users/`'s auth dependency — the sanctioned cross-module contact point, not a reach into `users/`'s internals):
- `POST /media/uploads` — validates the client-declared `mime_type` against `ImageUploadPipeline.ALLOWED_MIME_TYPES` (fail-fast UX check only; the real trust boundary stays `validate_type`'s Pillow-based check once the object is actually processed, unchanged), creates a `Media` row at `Uploaded`, and returns a presigned S3 `put_object` URL (5 min expiry) plus the quarantine key. **Scope note**: this unit only covers presigned-URL issuance — it does not implement the S3-event-triggered processing Lambda that runs `ImageUploadPipeline` (no real S3 event exists to trigger it from in this local/test setup; `test_pipeline.py` already exercises that pipeline directly). Wiring a real event trigger is Phase 6 CDK infra work, not app code.
- `GET /media/{media_id}` — **judgment call**: uploader-only (404, not 403, for anyone else's media or a nonexistent id, so as not to leak which ids exist). Media isn't public until attached to a `Post` and reaches `Processed`; that surfacing mechanism belongs to `posts/`'s own routes (Phase 2 proper), not to `media/` itself.

## Resolved decisions
- **Served-image/thumbnail dimensions — settled as 1600px / 200px longest-edge caps.** Implemented in `app.media.pipeline.ImageUploadPipeline.SERVED_MAX_EDGE` (1600) and `THUMBNAIL_MAX_EDGE` (200): both variants preserve aspect ratio and never upscale past the original (an image already smaller than a cap is kept at its original size for that variant).
- **Whether a `Rejected` `Media` row is retained — settled as yes.** The DB row stays (`status=REJECTED`) for user-facing error messaging / abuse pattern analysis; only the S3 quarantine object is deleted, with `s3_key_quarantine` cleared to `None` once that deletion happens. Implemented in `app.media.pipeline.AbstractMediaUploadPipeline.run()`'s `except MediaRejected` handling — see `app.media.state.transition` for the `Scanning -> Rejected` move and `_cleanup_quarantine_object` for the S3 delete.
