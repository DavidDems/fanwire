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
