# USERS-004: original member avatars

## Why this is full stack

`users/` currently stores `profile_picture_media_id` and returns that public
profile data through the users interface. The frontend's `Avatar` currently
uses the username's initial. There is no preset-avatar field, and profile
settings do not persist an avatar choice. A saved choice therefore needs one
small profile field, one API contract, and matching display behavior. The
avatar is metadata owned by `users/`, not a new media upload or an image URL.

## Decided behavior

The human chose: **selecting a preset replaces an uploaded profile photo**.
Persist `profile_avatar_key` as nullable text with a backend allowlist of eight
stable keys: `court-lines`, `ball-seams`, `shot-clock`, `scoreboard`, `arc`,
`net-grid`, `baseline`, `play-pattern`. No selection means the existing
username-initial avatar. Saving a preset clears the profile-picture media
reference; uploading a picture clears the preset key; neither clears media
bytes. Explicitly selecting “Use initials” sends null. Omitted PATCH fields
mean unchanged.

Render the same saved choice in own/public profile summaries, feed authors,
and account search results. Consumers read it through the existing users
public-profile interface and never query `users` tables directly. Keep the
avatar designs as original code-native SVG/CSS geometry using Fanwire tokens;
they are not files, uploads, or third-party assets.

## Branch and merge order

This unit is independent of FRONTEND-022/023/024. Cut `agent/USERS-004` from
`main` only after this Director PR is on `main`; do not base it on another
unmerged task branch. Suggested human review order is FRONTEND-022,
FRONTEND-023, FRONTEND-024, USERS-004, but no unit depends on a sibling and all
branches target `main` directly.

## Tests and privacy

The test-only commit covers enum validation, defaults, public/me serialization,
PATCH omission/null behavior, mutual exclusion with media, migration
round-trip, and the feed/search/profile displays. Then implement. Do not
backfill existing rows or delete stored media. Preserve the existing account
authorization and profile PII split. The browser pass uses only the authorized
localhost fwtest accounts; screenshots contain no credentials, and the
isolated context is closed at the end.

No new Python or frontend dependency, external asset request, or permanent
palette change. Include bundle measurements and browser rows in light/dark at
360/1280. Update users and frontend module contracts; update feed/search module
pages only if the user-profile response exposed there changes.
