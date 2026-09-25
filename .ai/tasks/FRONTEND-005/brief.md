# FRONTEND-005 — feed and threads

Depends on `FRONTEND-004` being on `main` (the reply/repost entry points call
into it). `FRONTEND-003` is independent of this unit.

## Composite, and what it buys

One `PostNode` interface renders a post and a thread uniformly at any depth.
That is the Composite pattern as assigned in `gof-patterns.md`, and the test
that proves it is a thread rendered three levels deep with no
thread-specific component in the tree.

`GET /feed/thread/{id}` returns the root plus **direct** replies only. Deeper
levels expand lazily by calling the same endpoint on a reply. Do not fetch a
whole thread eagerly; the endpoint does not offer it and the shape exists to
stop you trying.

## Decorator: one of the two, not both

`LiveScoreTickerDecorator` wraps a post view when `live_scores` is non-empty.

`PinnedPostDecorator` is in `gof-patterns.md` and **must not be built**. No
backend field marks a post as pinned, so it would decorate a condition that
cannot occur — YAGNI, and the acceptance criterion is written as an absence
precisely so the test pins it. Record the omission and the reason in the wiki
entry, so the next reader of `gof-patterns.md` does not re-add it.

## The API picks the strategy; the UI never learns which

A guest request and an authenticated request both hit `GET /feed`. The backend
chooses chronological or personalized ranking. The component renders whatever
came back.

A `if (isSignedIn) renderPersonalized()` anywhere in this unit is the failure.
It duplicates a decision the backend already made, and it drifts the moment the
ranking strategy changes.

## Media URLs

Keys come back as `media/{id}/…`, matching `app.media.pipeline`. The base is
`VITE_MEDIA_BASE_URL` from `src/config.ts` — `/media` in production, served by
CloudFront from the public-media bucket.

A media item that fails to load renders **nothing**. Not a broken image icon,
not an alt-text box with a border. A feed full of broken image frames is worse
than a feed of text.

## Optimistic like

Same shape as the follow button in `FRONTEND-003`: state and count both move
before the request returns, and both are restored on failure. If that unit has
landed, the rollback helper it introduced is shared code and belongs in
`components/` — reuse it rather than writing a second one.

## Reply and repost

These open the compose unit with context pre-seeded. This unit does not compose
anything: `frontend/src/features/compose/**` is in `forbidden_paths` on purpose.
If the seam compose exposes is not enough, that is a change to `FRONTEND-004`'s
work and a new task, not a wider diff here.
