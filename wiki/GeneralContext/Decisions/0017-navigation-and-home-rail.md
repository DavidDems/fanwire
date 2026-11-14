---
type: decision
---

# 0017 - Navigation, the home rail and reply context

Decision: 2026-11-05, and 2026-11-06 after seeing `FRONTEND-034` to `-036`
live, the human.

## Context

From the human's own reference images (a three-column home page and a reply
card), not in the repository, and then the first of those changes seen live
(the reply card and the home search move were "perfect").

## Choice

- **The nav (`FRONTEND-035`).** Below 40em, a bottom bar of icons only: Home,
  Stats, Notifications, Sign out. Search is an icon in the header, left of the
  avatar. From 40em, an icon-only left sidebar: Home, Stats, Search,
  Notifications, Sign out. "Feed" is renamed "Home". Sign out leaves the
  header; the avatar sits at the header's right end.
- **The sidebar shows its labels from 53.75em (860 px)** (`FRONTEND-039`), and
  sits closer to the left edge on tablets: at 1032 px (an iPad Pro 13) the
  icon-only sidebar sat about 150 px in. 768 px (an iPad mini) stays as it is,
  and desktop from 78em is unchanged.
- **Two Search links, one visible at any width**: a deliberate exception to
  `wiki/CodeContext/FrontendUI/layout.md` §1, because one link cannot move between the header and a
  fixed bottom bar by CSS. Tests scope them with `within()`.
- **No search bar above the feed, at any width.** `/` has a right rail with the
  search bar, a preview of results beside the feed (`FRONTEND-036`), and Recent
  games (`EVENTS-013`). **The rail needs the labelled sidebar beside it:** `/`
  shows the rail only from 76.0625em (1217 px), the width where the labelled
  sidebar, the feed and the rail all fit (measured by `FRONTEND-039`); below
  that, the feed alone. This supersedes "one column at every width" in
  `layout.md` §2.
- **A reply's card shows its parent** inside it, smaller, under the reply, with
  Show this thread (`POSTS-009`, `FRONTEND-034`), in the feed and in a thread
  alike. The feed includes replies with at least one like, a placeholder until
  there is data for real suggestions. No other change to post cards.
- **No Invite button** (`FRONTEND-038`). The control `FRONTEND-032` added
  beside the + goes, logic and look. Copy link stays in each post's menu.

## Consequences

- The shell, the Search exception and the rail as built: `wiki/CodeContext/FrontendUI/layout.md` §1
  and `wiki/CodeContext/FrontendUI/layout.md` §2; the breakpoints: `wiki/CodeContext/FrontendUI/tokens.md` §9.
- Recent games' order was later changed to newest day first
  ([ADR 0018](0018-ui-adjustments-2026-11-07.md)).
