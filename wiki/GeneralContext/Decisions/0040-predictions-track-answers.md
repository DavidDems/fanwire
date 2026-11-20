---
type: decision
---

# 0040 - Predictions: the human's answers for tracks 39–43

Decision: 2026-11-19, the human, answering every question the predictions
briefs (`Prompts/39`–`43`) had left for their sessions, so the tracks run
without stopping to ask. Builds on ADRs
[0037](0037-predictions-module-and-batch-lambda.md)–[0039](0039-our-prediction-disclosure-and-immutability.md).

## Context

The briefs marked a dozen choices "ask the human". They were asked together
before any session started. A session that meets a question this ADR doesn't
answer still asks; anything answered here is not re-asked.

## Choice

**Track 39, backend core**

1. **Board minimums (global boards only):** 15 settled picks for the month,
   50 for the season, 10 disagreements for Beat the model. Following boards
   have no minimum.
2. **Global boards need a verified email.** Picking stays open to every
   account, and an unverified user sees "Verify your email to appear on the
   leaderboard". This gates a public listing, not use, so ADR 0031 stands.
3. **Pick writes are limited to 300 an hour per user**, counted like posts, and
   answered with 429 beyond that.
4. **Picks are visible after the lock.** An open pick is hidden from everyone
   but its owner. From tip-off, a user's pick shows on their record, and the
   game shows the community split.

**Track 40, batch and integrations**

5. **The daily run is at 15:00 UTC.**
6. **The notification reads** "Your picks: 6 won, 4 lost · +68 points", with
   "· 1 not counted" when a pick was voided. There is one per user per run,
   linking to the user's picks.
7. **A void notifies on its own** when nothing else settled in that run: "Your
   pick for BOS–MIA was not counted: the game was postponed."

**Track 41, the Elo model**

8. **If the archived 538 page can't settle a value**, the session proceeds with
   the restated values (`Prompts/41-elo-model-spec.md`) and marks each
   unverified in `0x09` and on the record page. No wait on the human.
9. **The backtest is published as measured**, with no approval step, provided
   it uses the untuned parameters on 2005-06 to 2025-26. The PR shows the
   numbers.
10. **No margin is shown in v1.** `expected_margin` is stored and not displayed.
11. **No tuning in track 41.** A weakness the backtest finds (playoffs, neutral
    sites) is reported in the PR and becomes a backlog row for `elo-mov-2` or
    track 44.

**Track 42, the pick UI**

12. **On the game page**, the forecast reads as text first, then a neutral split
    bar, then the link:
    "Our prediction / BOS 64 % ▇▇▇░ 36 % MIA / How accurate is this? →".
13. **Picks are built into the upcoming-game card**: the Schedule tab's card for
    a coming game shows "Our prediction" and the two pick buttons. There is no
    separate Picks tab.
14. **The buttons read** "BOS +10" / "MIA +16", with an accessible name like
    "Pick Boston Celtics, 10 points if correct".

**Track 43, boards, navigation and launch**

15. **Navigation** (amends ADR [0017](0017-navigation-and-home-rail.md)'s nav
    bullet):
    - **A new top-level Rankings page** holds the boards: Points / Beat the
      model, the period, Global / Following, and the viewer's row pinned.
    - **Phone bottom bar:** Home, Schedule, Rankings, Stats, Sign out. Five
      cells and no hamburger.
    - **Phone header:** Notifications becomes an icon at the top right, left of
      the profile avatar, which keeps its place. Search stays in the header.
    - **Tablet and desktop:** the sidebar lists every item, Rankings included,
      with no menu.
16. **A user's picks and record live on their profile**: the record line
    ("38–21 · 412 pts · vs our prediction 9–6") and a Picks list.
17. **The home rail gets a "Your picks this week" card**: open picks and the
    month rank, linking to Rankings and the profile.
18. **Launch when track 43 is done.** Its last unit switches
    `PREDICTIONS_ENABLED` on, and the human's deploy approval is the launch
    control. There is no announcement post.

## Consequences

- The verified-email rule needs `users/` to know verification without a
  Cognito call per row. Track 39 adds a stored flag synced from the token's
  `email_verified` claim on sign-in and after verification, read through a
  `users` service function. This is a users unit inside track 39.
- The navigation change moves Notifications out of the phone bar. `layout.md`,
  `components-map-pages.md` and the shell tests change in track 43's
  navigation unit (Director PR for `FrontendUI/`). The rail card makes the
  rail's late keyboard order (backlog, Frontend) more noticeable, so that item
  is worth doing first.
- Briefs `39`–`43` point here instead of asking.
