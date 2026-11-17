---
type: prompt
---

# 33 — Outstanding work, track 4: backend-led product fixes

**Brief for a Director session.** Shared rules: [29](29-outstanding-work.md).

**Objective:** four user-visible fixes that start in the backend, each with
the human's answer already recorded ([ADR 0035](../Decisions/0035-outstanding-work-answers.md)).
Closes the backlog rows for the email toggle, the username rule, deactivated-
only follows and the missing-post consumer.

## Read first, in this order

1. `wiki/CodeContext/Modules/0x05-notifications.md` "Email is off in
   production", `0x01-users.md` and `0x01c-users-routes.md`, `0x06-feed.md`,
   `0x03a-posts-post.md` "Open decisions".
2. `wiki/CodeContext/FrontendUI/typography.md` §1 (the look-alike cost).
3. `Architecture/director-sessions.md` "Sibling PRs": units here touch
   `app/users/schemas.py` and `app/notifications/`; run them one at a time.

## Where things stand (2026-11-17), verify, don't trust

- `NotificationPreference` stores "email me" and the UI shows a toggle, but
  email is off in production, so the toggle does nothing.
- `username` is a bare `str` in `app/users/schemas.py`.
- A user whose follows are all deactivated gets the thin follows feed, not
  the guest selection (`FEED-001`).
- `notifications/` treats a missing post as a malformed event
  (`MissingReferenceError`), so a repost undone before the consumer runs
  reaches the DLQ; the REPOST notification outlives the undo.

## Deliverables (one unit each, in this order)

1. **Username rule.** The human's pattern
   `^(?!.*\.\.)(?!.*\.$)\w[\w.]{0,29}$`, whole-string, ASCII-only (compile with
   `re.ASCII` and `fullmatch`; the human's `g`/`m` flags are dropped on
   purpose, since `m` lets a newline smuggle in a second line). Backend schema
   first, then the profile-setup form's client-side message. **Existing names
   that break it** (look at the data model's constraints, and the 30-char and
   case rules): do not rename anyone silently. Grandfather them (reads
   accept, new writes enforce), and say so in the spec; ask the human only if
   grandfathering is unsafe. Update `typography.md`'s "until then" note.
2. **Email availability.** The preference response gains a field (for
   example `email_available`) driven by the backend's own setting for whether
   email is on. Keep storing the preference. The frontend caption or disables
   the toggle from the field, not a build flag. Paired units (backend, then
   frontend), test first, OpenAPI types regenerated (`npm run gen:api-types`).
   Delete the `0x05` "Email is off in production" caveat when it's true.
3. **Deactivated-only follows.** Such a user gets the guest selection, as
   `FEED-001` intended. The red test is the backend feed query's.
4. **A missing post in the `PostCreated` consumer.** A missing post is a no-op
   (logged, not retried, not dead-lettered). Sensible default for the open
   half: undoing a repost removes the notification it created. State it in
   the spec; ask the human only if the removal conflicts with `0x05`.

## Mechanics learned the hard way

- A migration is never needed for a schema-only rule; if a unit adds an
  Alembic revision, the deploy needs the Migration Lambda run right after, and
  routes on the changed tables answer 500 until then. Say so in the PR.
- Usernames are shown exactly as typed (ADR 0010): no case folding.
