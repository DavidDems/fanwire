---
type: decision
---

# 0016 - Team icons and avatar colours

Decision: 2026-11-02, the human.

## Context

The look and feel had no team colours anywhere and showed teams as text
([ADR 0014](0014-look-and-feel.md)). A team's colour pair is a hazard in
fanwire's own brand (`wiki/CodeContext/FrontendUI/branding.md` §10), but the site needs some
representation of a team.

## Choice

- **Team icons replace "text only".** Each team gets a round icon, its
  abbreviation in black on an inner colour with an outer ring, as code and no
  image (`FRONTEND-031`). This supersedes "no team colours anywhere" in
  `components.md` and the team-colour line of `direction.md`, a choice the human
  made knowing `branding.md` §10. No logos still holds.
- **Avatars take colours from the same palette**, inner from inner and outer from
  outer, over the initials. The eight geometric presets are removed (`USERS-005`).

## Consequences

- **Team icons are built** (`FRONTEND-031`): `TeamIcon` is
  `wiki/CodeContext/FrontendUI/components-sports.md` §4, and the team colour tokens are
  `wiki/CodeContext/FrontendUI/tokens.md` §10.
- **The avatar change is planned, not built.** `USERS-005` is still a draft,
  and `Avatar` still draws the eight presets (`wiki/CodeContext/FrontendUI/components-shared.md` §2).
- fanwire's own promotion never shows a team icon
  ([ADR 0006](0006-no-nba-marks-in-promotion.md)).
