# FRONTEND-040: sidebar bar, no matchup artwork, no Quick posts

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## The human's ask (2026-11-07)

1. **Sidebar.** From 860 px, where the sidebar gains labels and moves near the
   edge, up to 1248 px, the current page's left bar overlaps the link's icon
   (screenshot: the bar runs through the Home icon). "Simply add a bit of
   padding" so the highlight never reaches the icon.
2. **Game view.** Remove the matchup artwork (the court drawing with both
   teams, their scores and the date) entirely. The order becomes header, line
   score, team box score tabs: "those three are all perfect".
3. **Composer.** Remove the Quick posts section and its logic: "it's useless
   and the messages are corny".

## Where it is (checked 2026-11-07 at `668e590`)

- `routes/AppLayout.module.css`: from 53.75em `.link` has `padding-inline: 0`
  and the current-page `::after` bar sits at `left: 0`, so the icon starts
  where the bar is. From 78em `.link` has `padding-inline: var(--space-3)`,
  which is why 1248 px and up look right.
- `features/games/GamePage.tsx` renders `<MatchupArtwork>` between the header
  and `LineScore`; its rules are in `Games.module.css`.
- `features/compose/ComposePage.tsx` renders `QUICK_POST_TEMPLATES` from
  `PostTemplate.ts` in `<section className={styles.quick}>`.

## Decided (Director, 2026-11-07)

- The fix is padding on the link in the 53.75em–78em range (the human's
  wording), not moving the bar. At least `--space-2` between bar and icon.
- The three asks are one unit: each is a small removal or a one-rule change,
  and none shares a file with another unit in this track.
- `Standards/gof-patterns.md` assigns Prototype to `PostTemplate.clone()`. A
  unit cannot write Standards, so the Director corrects that line in the
  track's Finish PR.
