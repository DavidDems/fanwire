# FrontendUI — typography

**Agent-facing.** The UI typeface, the scale, the weights, how the name
`fanwire` is set, and what was weighed. Token values are in `tokens.md` §8.

## 1. The typeface: the system font stack (decided 2026-10-06)

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans",
  "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
```

- **Licence: none needed.** Nothing is shipped, so the bundle carries no font
  file, no `@font-face` and no `<link rel="preload">`.
- **Hosting: none.** No third-party request, no CSP `font-src` to widen, and no
  flash of unstyled or invisible text.
- **Weights: 400, 600 and 700 only.** Every platform face in the stack has them.
  A weight between those is synthesised or snapped differently per platform, so
  it isn't used.
- **Figures: tabular by default in Segoe UI** (all ten digits are 1104 units
  wide in `segoeui.ttf`, checked 2026-10-06). San Francisco and Roboto are
  proportional by default and have `tnum`. So every number that is compared
  down a column or changes in place (scores, counts, timestamps) sets
  `font-variant-numeric: tabular-nums` explicitly, and never relies on the
  platform default.

### What was weighed

The plan recommended **Atkinson Hyperlegible Next** (OFL, one variable file for
200–800, a 38 KB Latin woff2 subset, tabular figures). The human chose the
system stack. Both are recorded so the next session doesn't re-run the
comparison:

| Candidate | Latin woff2 | `I` / `l` / `1` / `0` distinct? | Why not |
|---|---|---|---|
| **System stack** (chosen) | 0 KB | **No** in Segoe UI and SF | — |
| Atkinson Hyperlegible Next | 38 KB variable | **Yes**: serifed `I`, tailed `l`, slashed `0` | The human preferred zero bytes and native rendering |
| Outfit (the wordmark's family) | 39 KB variable | No: `I` and `l` are identical | Geometric, so weaker at body sizes |
| Inter 4 | 110 KB variable | Only with `ss02`/`cv` features | Three times the bytes |
| Public Sans | 29 KB variable | No | No gain over the system stack |

Measured from the `google/fonts` files with fontTools on 2026-10-06, subset to
Basic Latin, Latin-1 and Latin Extended-A plus general punctuation.

### The known cost: look-alike usernames

Usernames are shown exactly as typed (`decisions.md`), and the backend puts no
character rule on them (`app/users/schemas.py`: `username: str`). In Segoe UI
and SF, `@Illini_1` and `@lllini_l` are almost indistinguishable at 16 px. That
is an impersonation vector the typeface can't fix.

**The fix belongs to the backend:** a username character rule (for example
lowercase `[a-z0-9_]`, which removes `I` entirely and leaves `l` vs `1`, which
the system faces do separate). That is a `users/` decision for the human, not a
styling unit's. It's recorded here and in the PR so it isn't lost. Until then:

- a username is always a link to the profile, so the profile, not the glyphs,
  is the identity check;
- usernames get no letter-spacing or condensed treatment that makes them worse.

## 2. Scale and use

| Element | Size token | Weight | Line height | Notes |
|---|---|---|---|---|
| Page `h1` (`Feed`, `Sign in`, a username on a profile) | `--font-size-xl` on phones, `--font-size-2xl` at ≥ 640 px | 600 | tight | One per page. Every view already has exactly one, and the route sweep pins it |
| Section `h2` (`Quick posts`, `Settings`) | `--font-size-lg` | 600 | tight | |
| Body, post text, inputs | `--font-size-md` | 400 | body | Never below 16 px for inputs (iOS zooms on focus otherwise) |
| Post author | `--font-size-md` | 600 | tight | `ProfileSummary`'s `h1` uses the page `h1` style |
| Metadata: time, counts, hints | `--font-size-sm` | 400 | body | `--color-text-muted`, tabular figures |
| Buttons, nav labels | `--font-size-md` (`sm` inside a post footer) | 600 | tight | Sentence case |
| Badges (Live, game state, team abbreviation) | `--font-size-xs` | 600 | tight | 12 px is the floor. Never uppercase-transform: the word stays readable to a screen reader and to the eye |
| Score figures | `--font-size-2xl` | 700 | tight | Tabular figures |

- **Post text** keeps the line breaks the user typed (`white-space: pre-wrap`)
  and wraps long words (`overflow-wrap: anywhere`), so a pasted URL can't widen
  the column.
- **Measure:** the 640 px content column holds about 70–75 characters at 16 px,
  inside the comfortable range, so no extra `max-width` on paragraphs.
- **No italics** in the UI. There is none in the app today.

## 3. The name `fanwire` (`decisions.md`, 2026-10-02)

The rule is applied everywhere the UI writes the name:

| Where | How |
|---|---|
| Header | The wordmark SVG (`wordmark-light.svg` / `wordmark-dark.svg`), name in the accessible text (`layout.md` §2). Until `UI-02` lands, the plain text `fanwire` in `--font-sans` 600 |
| `<title>` | `fanwire` alone on every page today (it's already that in `index.html`). Per-route titles aren't in scope |
| Manifest | `"name": "fanwire"`, `"short_name": "fanwire"` |
| Alt text and accessible names | `fanwire`, never `Fanwire` or `FanWire`, including at the start of a sentence |
| Everything else | Sentence case ("Sign in", "Show replies", "Create your profile") |

**The wordmark and the UI font don't need to match.** The wordmark is Outfit
SemiBold (600) as SVG paths (`branding.md` §3.2, `decisions.md` 2026-10-05). It
loads no font, so the system-stack choice costs it nothing. In the interim
plain-text header, `fanwire` is set in the system stack at weight 600. That is
correct for the interim and disappears when the SVG lands.

## 4. Reconciling with `branding.md`

`branding.md` §3.2 said: *"If `11` has picked the UI typeface by then, prefer
that font, or one that sits well beside it."* `12` ran first and chose Outfit
600 before any UI typeface existed. With the system stack chosen for the UI,
that advice is moot: there is no UI webfont to match, and the wordmark is
paths. `branding.md` is left as written, with a one-line pointer to this
section at its top.
