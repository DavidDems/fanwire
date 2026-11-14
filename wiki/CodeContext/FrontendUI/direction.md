---
type: reference
---

# FrontendUI — direction

**Agent-facing.** How fanwire should look and feel, and why. Read this before
any styling unit; it is short on purpose. [ADR 0014](../../GeneralContext/Decisions/0014-look-and-feel.md) outranks it.

## In a few words

**Scoreboard-crisp, calm, dense.**

- **Scoreboard-crisp.** Numbers are the most important thing on a sports
  screen, so they get the most typographic care: tabular figures, a fixed
  home–away order, the score larger and heavier than anything around it.
  Hierarchy comes from size and weight, not from colour.
- **Calm.** Surfaces are neutral and tinted toward Jet Black, so the palette
  reads as one family. Colour appears only where it means something: Teal for
  the action you can take, the state colours for success, warning and error, and
  raspberry for **Live**. A screen with nothing live and nothing wrong is almost
  monochrome, and then a live game stands out.
- **Dense.** A fan scrolls a lot of short posts. Cards are compact, metadata
  sits on one line, and spacing is tight inside a post and generous between
  posts. Dense is not cramped: every target stays at least 24 px (and 44 px for
  primary controls on touch; `accessibility.md`).

## What it borrows from

| Source | What is taken | What is not |
|---|---|---|
| Broadcast score bugs | Compact score blocks, tabular figures, a small live marker | Animated swooshes, team colour bars |
| Newspaper agate pages (box scores, standings) | Density, alignment on figures, weight over colour | Tiny type |
| Calm reading apps | Neutral surfaces, one accent, quiet chrome | Endless whitespace that costs density |

## What fanwire is not

- **Not a team-coloured fan site.** No crests, jerseys or logos, and no team
  colour as page decoration (`branding.md` §10). A team's two
  colours appear on its small round icon, and nowhere else ([ADR 0016](../../GeneralContext/Decisions/0016-team-icons-and-avatar-colours.md)). Teams
  appear as text beside it. Teal is ΔE 1.4 from
  the Charlotte Hornets' teal, so it stays on small surfaces: buttons, links,
  focus rings and selection marks. It is never a page background, a header bar
  or a hero.
- **Not a neon esports UI.** No glow, no gradients, no glassmorphism, no motion
  for its own sake.
- **Not a generic blue social clone.** The palette is Jet Black, Teal and Pale
  Sky, and the moments that matter are sports moments, not engagement counters.

## The moments to design for

From `wiki/GeneralContext/Architecture/business-rules.md` and what the app does
today. These get the care; everything else is plain.

1. **A post about a live game.** No live score is shown today. When a score
   block returns, it is the most prominent thing in that card, with a
   **Live** badge (raspberry, always with the word): `components-sports.md` §4.
2. **A score that changed.** Nothing polls today: what the page was handed is
   what it shows (`0x08f-frontend-feed.md`). When polling arrives, a changed figure
   gets a single short highlight, which is none under reduced motion, and a
   `role="status"` region announces it.
3. **A reply, follow or repost to you.** The notifications list is the place a
   fan comes back to. Unread state isn't in the API yet, so rows are plain, and
   the actor's name is the strongest element.
4. **Posting.** The composer is one surface: text, the attach row (image,
   stats), Post. A failed post keeps the draft and says so beside the Post button.
5. **First visit as a guest.** The guest feed is public. Sign-in is offered
   once in the header, not in a modal or interstitial.

## Principles, in priority order

1. **Legible before branded.** Body text in the system stack at 16 px, with
   AA contrast measured, not judged (`tokens.md`).
2. **Colour never carries meaning alone.** Live has the word, errors have the
   message, the selected tab has a bar as well as a colour (`accessibility.md`).
3. **The structure in the code is the structure on screen.** `FormField` owns the label,
   hint and error layout. Styling fits these patterns and doesn't go round them.
4. **One way to do each thing.** One button component with variants, one alert,
   one status line (`components.md`). A unit that needs something new adds it to
   `src/components/ui/`, never as a one-off.
5. **No third-party requests.** Fonts, icons and images ship in the bundle
   (`typography.md`, `components-shared.md` §3).
