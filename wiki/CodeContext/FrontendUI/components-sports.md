---
type: reference
---

# FrontendUI — components: sports-specific

Part of [components.md](components.md). Token names are from [tokens.md](tokens.md).

## 4. Sports-specific

### Score block (`GameScore`, inside `LiveScoreTickerDecorator`)

Nothing renders `GameScore` today (`components-shared.md` §2); this section
is the design to reuse if a score block returns.

```
┌ status region "Live score" ───────────────────────────────┐
│ (●Live) Q3 · Game 789                                     │
│ Home  95  –  99  Away                                     │
└───────────────────────────────────────────────────────────┘
```

- **The decorator adds a block below the post view and never restyles it.**
  It renders its children untouched and then the ticker, as now. The ticker is a
  `--color-surface-muted` band at the foot of the post's content, with
  `--radius-sm`.
- **Figures:** `--font-size-2xl`, 700, `tabular-nums`, home first, an en dash
  between. **Home and Away are words, not team names**, because
  `LiveScoreView` carries only `game_id`, the two scores and `status`. Naming
  teams needs the backend to add home and away abbreviations to `LiveScoreView`.
  That's a follow-up for `feed/`, not a styling unit; it is listed in the PR.
- One `GameScore` per game, in the existing `<ul>` (a post can mention
  several). The `role="status"` and `aria-label="Live score"` stay exactly as
  they are.

### Game state

`LiveScoreView.status` is the vendor's short code, passed through as text. The
vendor shape is **unverified** (`0x02-events.md`: the adapter's API-SPORTS
parsing is illustrative), and `Game` has no status column. So the mapping is a
small table with a safe default, and it never claims "Live" for a code it
doesn't know:

| `status` | Badge | Shown text |
|---|---|---|
| `Q1` `Q2` `Q3` `Q4` `OT` `BT` `HT` | `live`, with the word **Live** | the code, e.g. "Q3" |
| `FT` `AOT` | `neutral` | **Final** (and "Final (OT)" for `AOT`) |
| `NS` | `neutral` | **Scheduled** |
| `POST` `CANC` `SUSP` `AWD` `ABD` | `neutral` | Postponed / Cancelled / Suspended / Awarded / Abandoned |
| anything else | `neutral` | the code as given |

### Team identity

- **Text first: the team name, or its abbreviation in an `outline` badge.** No
  logos in v1 ([ADR 0014](../../GeneralContext/Decisions/0014-look-and-feel.md)). `TeamOut.logo_url` points at
  API-SPORTS's media host. API-SPORTS says logos are provided *"solely for
  identification and descriptive purposes"*, that it owns no rights in them,
  and that users are responsible for their use (API-SPORTS documentation,
  read via search 2026-10-06). The marks belong to the leagues and clubs, who
  police them (`branding.md` §10). Hotlinking would also be a third-party
  request on every view.
- **A team's colours are shown only through `TeamIcon`** ([ADR 0016](../../GeneralContext/Decisions/0016-team-icons-and-avatar-colours.md);
  `FRONTEND-031`). Still no logo, crest or image.

**`TeamIcon` as built** (`components/ui/TeamIcon`; props in `0x08a-frontend-shell.md`
→ Team icons):

- **Drawing.** A circle: the abbreviation in black (`--team-outer-black`, bold)
  on the team's inner fill, inside a ring of its outer colour, then a 1 px
  `--color-border` hairline outside the ring so a dark ring still reads on the
  dark surface. Text and CSS only: no image, no SVG. Colours are the
  `--team-*` tokens (`tokens.md` §10).
- **Sizes.** `sm` 32 px (2 px ring), `lg` 64 px (3 px ring).
- **Type: an explicit exception.** The abbreviation is bold at `0.6875rem`
  (11 px) at `sm` and `1.375rem` (22 px) at `lg`, raw values rather than
  tokens. 11 px is below the 12 px `--font-size-xs` floor (`tokens.md` §8),
  kept because three letters must fit inside the ring at `sm` (measured ink:
  MEM 26.38 px, GSW 25.99 px, against a 26.83 px inner width; at 12 px MEM
  would not fit).
- **Unknown or null team:** the neutral form, `--color-surface-muted` fill,
  `--color-border` ring, `--color-text` abbreviation (empty if null).
- **Accessibility.** `aria-hidden` when the team's name is adjacent text (the
  usual case); `role="img"` named by `label` only where the icon stands alone.
  Under `forced-colors: active` fill and hairline drop and the ring stays as a
  `CanvasText` line.
- **It never replaces text.** The name or abbreviation is still shown beside
  it; dense opponent cells stay text, no icon.
- **Used in** standings, team and records levels, team search, the game
  header and box score, feed game previews, stats picker rows and the player
  page's team fact (full list: `0x08a-frontend-shell.md` → Team icons).

### Mentions in posts

**`#GameId<n>` is a link since `FRONTEND-008`**, to `/games/<n>`, and only
when the server resolved it (`mentioned_game_ids`; `0x08h-frontend-search-games.md` →
Game page). **As built it is a plain text link**, not the inline `neutral`
badge this section reserved; the badge style stays reserved if a later
unit wants it. `$TOR` is still rendered as typed and deliberately resolves
to nothing.
