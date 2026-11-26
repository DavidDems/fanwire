# USERS-005: avatar colours

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Decided by the human, 2026-11-02

All eight icon presets go. Initials are the only form for now. A user picks one
inner and one outer colour, from the same arrays the teams use, with no crossing
between them. Black text always, unless no background is picked.

## Decided here

- **The column is dropped rather than kept empty.** "For now" could suggest other
  forms later, but `profile_avatar_key` would hold nothing and a future form can
  add a column in one migration.
- **Inner and outer are independent**, each with None. It is the simplest thing
  that matches "no background colour picked", and outer without inner is
  legitimate.
- **Nothing migrates a preset to a colour.** Few accounts exist, and each simply
  returns to the default.
- **First character, not two initials**: usernames are one word, and the existing
  default is what "initials" means on the site today.

## Deploy

Adding columns while removing one, with the human running `Migration` after the
deploy. Until it runs, every `GET /users/me` and any feed or search read that
loads `User` fails. Say so in the PR, and do not approve the deploy until the
human is ready to run the migration straight away.

## Traps

- `ProfileSettings`' `avatarTouched` exists to clear a picture when a preset is
  chosen. That behaviour is gone, so remove the state with it.
- `get_public_profiles` is the one route other modules read profiles through.
  `PublicProfile` gains the two fields, and `feed/` and `search/` map them; neither
  queries `users`.
- Avatar's first-character test uses emoji as typed. Keep `Array.from`.

## Preserved work (2026-11-13)

- **Scope.** The human approved adding `frontend/src/routes/AppLayout.tsx` and
  its test to `allowed_paths` and lifting the `frontend/src/routes/**` ban,
  because the shell's account button (`AppLayout`) must show the same avatar.
  Other route files stay outside `allowed_paths`.
- **Red tests.** The unfinished failing tests from the old local worktree are
  `parked/users005-red-tests.patch` (applied in track 6, #117, then deleted), 11 test
  and fixture files, no implementation. It applies cleanly to `main` at
  `fanwire-archive@05bce80`. Re-check it against the acceptance criteria, then apply it as the
  test commit. The local hand-start `state.json` was not carried over, so this
  task reads as DRAFT.

## Resumed in track 6 (2026-11-25)

- **The parked patch still applies** to `outstanding-track-6` at `7c335bf`
  (`git apply --check`, one hunk offset by a line). Apply it as the start of
  the test commit, then add what it lacks:
  - `test_migrations_users_avatar.py` still pins `_PARENT_REVISION =
    "b5e9c3a7d2f1"` and inserts `profile_avatar_key` there, before
    `c7a4e2f9b6d1` adds that column. Point it at the current head
    (`fd9d2851baf5`, USERS-011).
  - an `AppLayout.test.tsx` case: the shell's account button renders the
    same avatar for each colour combination;
  - the type-level test that the generated unions equal the palette keys;
  - `routes/home-rail.test.tsx` builds accounts with `profile_avatar_key` and
    queries `data-avatar-key`, so removing the presets breaks it. It is now in
    `allowed_paths`; repoint it at the new avatar (test_agent), with no change to
    what it proves.
- **Re-measure the bundle budget**: the patch's numbers predate the BASE
  refolds of tracks 2 to 5, and its `changed` entries name today's lazy
  outputs only if they still exist. Never declare more than the criteria's
  2 KiB raw and 1 KiB gzip entry growth.
