# FRONTEND-004 — compose

Depends on `FRONTEND-002` being on `main`. Independent of `FRONTEND-003`.

## The patterns are assigned, not suggested

`wiki/CodeContext/Standards/gof-patterns.md` already says which pattern
implements which piece of this. Do not substitute a different one because it
reads more naturally in React:

| Piece | Pattern |
|---|---|
| Assembling `CreatePostRequest` across steps | **Builder** — `PostBuilder`, with validation in `build()` |
| Text box ↔ autocomplete ↔ media widget | **Mediator** — `ComposeMediator` |
| Undo after attaching live-event data | **Memento** — `DraftSnapshot` |
| Quick-post templates | **Prototype** — `PostTemplate.clone()` |

The Mediator is the one that earns its keep here. Three controls that each need
to know what the other two are doing is the case it exists for, and the
alternative — each importing the others — is the connection rule violation this
codebase keeps writing tests against. A test that asserts no two of the three
import each other is worth more than a test of the mediator's own methods.

`clone()` producing an *independent* draft is the Prototype criterion that
actually matters. A shallow copy that shares the media-id array looks correct
until the second template is used.

## Media upload — the shape, and why

`POST /media/uploads` returns `upload_url`, `fields` and `max_bytes`. The
browser sends a multipart POST of those fields plus the file **straight to S3**.
File bytes never pass through the API — that is the entire reason the presigned
POST exists, and routing them through FastAPI would put a Lambda body-size limit
in front of every image.

Client-side type and size checks are for UX only. S3's policy and the backend
enforce both regardless, so a client check that is wrong is a bug in the message
the user sees, not a security hole. Do not skip them and do not rely on them.

## Quarantined is not a failure

An uploaded object sits in `Quarantined` until GuardDuty's scan verdict moves it
to `Processed`, and only `Processed` media can be attached to a post. Poll
`GET /media/{id}` and show progress.

**Locally there is no GuardDuty**, so an upload against the real dev buckets
stays `Quarantined` forever. That is correct behaviour, not a bug — the dev-only
script that runs the processing pipeline on demand is task `MEDIA-002` and does
not exist yet. Test against msw; if you cannot verify the full upload path in a
browser, say so in the PR and say why. Do not report it as verified and do not
build a workaround.

## Draft preservation

A failed `POST /posts` keeps the draft. Losing a user's typed text on a 500 is
the single worst failure this component can have, and it is the one that
survives review most often because the happy path is what gets clicked.
