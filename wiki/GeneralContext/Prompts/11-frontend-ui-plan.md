# 11 — Plan the frontend's look and feel

**Objective:** the SPA works but has no styling at all: there is no CSS file and
no `className` anywhere in `frontend/src`. **This prompt does not style it.** It
investigates the app and the stack, picks one direction for how fanwire should
look and feel, turns that into requirements, and creates
`wiki/CodeContext/FrontendUI/` as the reference that later implementation units
are built from. A later prompt writes those units. Write it so that someone
holding only `FrontendUI/` and one unit's spec can build that unit well.

This is a design-and-architecture session that needs high reasoning. Reading and
deciding are the work; there is little to type.

**Read first:** `00-session-protocol.md` (you are a Director); then
`wiki/CodeContext/FrontendUI/decisions.md`, which holds the human's palette, the
lowercase-name rule and the `ui-design` skill's provenance. That file outranks
everything you produce.

## Investigate before deciding

Look at the real thing, not a summary of it.

- **What the app is for:** `wiki/GeneralContext/Architecture/business-rules.md`.
  Sports fans posting about games, live scores, following people, notifications.
  Find the moments that matter to a fan, such as a live game, a score change or
  a reply, and design for those, not for a generic social feed.
- **What exists:** every view under `frontend/src/features/`, `src/auth/` and
  `src/routes/`, plus `wiki/CodeContext/Modules/0x08-frontend.md`. List every
  screen, every state (loading, empty, error, optimistic, disabled,
  `rejected`/`uploaded` media) and every interactive control. The plan has to
  cover all of them. Note the patterns already in place: `FormField` (label and
  ARIA wiring), the `PostNode` Composite and the `LiveScoreTickerDecorator`.
  Styling must fit those, not fight them.
- **The stack's constraints:**
  - `frontend/package.json`: React 18, Vite 5, no styling dependency yet.
  - `frontend/index.html`.
  - `.ai/tasks/FRONTEND-00N/task.json`: workers may not touch
    `frontend/package.json`, so **any new dependency is a Director PR before the
    units that use it**. Weigh that cost.
  - Vitest with jsdom, which computes no layout and almost no CSS. Decide what a
    styling unit's tests can honestly assert, and what needs a real browser.
  - `wiki/GeneralContext/Architecture/human-decisions.md` §3: browser
    verification is NOT DONE unless a tool really drove the app.
- **Delivery and security:**
  - `infra/lib/cdn-stack.ts` serves the bundle with CloudFront's managed
    `SECURITY_HEADERS` policy, which sets no Content-Security-Policy today.
  - `wiki/CodeContext/Standards/security.md` and `design-principles.md`. A font
    or icon fetched from a third-party CDN is a request to that party on every
    page view. Prefer self-hosted assets in the bundle, and say why if you
    recommend otherwise.
- **Guidance:** `.claude/skills/ui-design/` (`SKILL.md` and its three references).
  Use it; where it conflicts with `decisions.md` or `design-principles.md`, those
  win.

## Decide: one plan, with reasons

For each question below, give a **recommendation and its reasons**, plus the
runner-up and why it lost, in a sentence or two. Do not produce a survey.

1. **Direction.** The personality in a few words (e.g. "scoreboard-crisp,
   calm, dense"), what it borrows from, and what it explicitly is not.
2. **Styling mechanism.** Options include plain CSS with custom properties,
   CSS Modules (Vite supports them with no dependency), Tailwind, or a
   zero-runtime CSS-in-TS library. Optionally, unstyled accessible primitives
   such as Radix for dialogs and menus. Judge each against: no runtime cost,
   reviewability in a diff, how a worker unit scoped to one feature folder adds
   styles without editing a shared file, and the `package.json` constraint.
3. **Tokens.** Colour (the human's palette, plus the neutral ramp, semantic
   states and dark mode that `decisions.md` says it needs; every text/background
   pair with its measured contrast ratio), type scale, spacing, radius,
   elevation, motion, breakpoints and z-index. Write actual values, not
   categories.
4. **Typeface.** Pick the UI typeface, or deliberately keep the system stack.
   Cover licence, self-hosting, weights, file size, and how lowercase `fanwire`
   looks in it. A wordmark's lettering belongs to `12`; coordinate if `branding.md`
   already exists.
5. **Layout.** Mobile-first. The app shell (navigation on phone and desktop),
   the width of the content column, and one page template per route.
6. **Components.** The primitives to build (button variants, input,
   card/surface, avatar, badge, tabs, toast/inline alert, skeleton, empty state,
   and so on). Map every existing component and view to them.
7. **Sports-specific UI.** Live score, game state (scheduled, live, final),
   team identity (beware: team names and logos from API-SPORTS may carry
   trademark and licence limits; check before planning to show logos) and event
   mentions in posts.
8. **Accessibility.** WCAG 2.2 AA as the floor: focus visibility, target sizes,
   reduced motion, colour never as the only signal, and the teal-on-dark trap.
9. **Verification.** What each unit's tests assert, given jsdom. Candidates:
   a token-contrast test over the token file, class and ARIA presence, and
   snapshot policy (decide, don't default). Also which checks need a human in a
   browser, and how they are reported.
10. **Sequencing.** Break the work into implementation units the size of a
    `FRONTEND-00N` task: tokens and base styles first, then shell, primitives
    and each feature. Give each a one-line objective, acceptance criteria phrased
    so they can fail first, a sketch of its `allowed_paths`, and whether it
    needs a Director PR first (dependencies, `index.html`, font files under
    `frontend/public/`). **Do not create `.ai/tasks/` specs:** writing them is
    the next prompt's job, after the human approves this plan.

**Checkpoint with the human before writing the wiki.** Present the direction,
the mechanism, the typeface and the sequencing in a few lines each, and ask
(one question at a time if they conflict). The human makes the call. You
recommend.

## Write `wiki/CodeContext/FrontendUI/`

Small files that are loaded just in time (`AGENTS.md` "Context loading"), so a
unit can be handed two or three of them and not the whole folder:

| File | Holds |
|---|---|
| `index.md` | What the folder is, which file answers which question, and which files to hand which kind of unit |
| `decisions.md` | **Exists. Human-owned.** Append any decision the human makes at the checkpoint, dated. Never alter an existing one |
| `direction.md` | Personality, principles, references, and what fanwire is not |
| `tokens.md` | Every token with its value, light and dark, plus the contrast table |
| `typography.md` | Typeface, scale, weights, hosting, and the lowercase-name rule applied |
| `layout.md` | Shell, breakpoints, and the per-route templates |
| `components.md` | Primitives, variants and states, mapped to existing components |
| `accessibility.md` | The AA requirements as testable statements |
| `verification.md` | What tests assert, what a human checks in a browser, and how each is reported |
| `implementation-plan.md` | The sequenced units from question 10 |
| `branding.md` | **Owned by `12`.** If it does not exist yet, create a stub that says so, and leave it alone if it does |

Also update:
- `wiki/GeneralContext/index.md` (folder map and prompt status);
- `0x08-frontend.md` (a pointer to `FrontendUI/`; settle its "Open decisions"
  item on splitting the frontend wiki if this answers it);
- `AGENTS.md` "Wiki structure", which lists the `CodeContext` folders. It is a
  restricted tree, so **say so in the PR body**.

## Out of scope

- Any change under `frontend/`, including a dependency install. A throwaway
  spike to check a claim is fine; do not commit it.
- Colour and brand research, logo and icon: that is `12`. If `branding.md`
  already holds accepted decisions, build on them. If not, plan on the current
  palette and the plain-text name.
- `.ai/tasks/` specs.

One PR, on a human-named branch. Merge nothing.
