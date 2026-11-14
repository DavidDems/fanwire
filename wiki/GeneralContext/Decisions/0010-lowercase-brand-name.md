---
type: decision
---

# 0010 - The brand name is always lowercase

Decision: 2026-10-02 (the name) and 2026-10-06 (the tagline), the human.

## Context

The name `fanwire` appears in the header, the page `<title>`, emails, the app
manifest, alt text and running copy, and the look-and-feel reference
(`wiki/CodeContext/FrontendUI/index.md`) needs one rule for how it is written.

## Choice

- **The brand name is always lowercase: `fanwire`.** This covers the header,
  the page `<title>`, emails, the app manifest, alt text and anywhere else the
  name appears, including at the start of a sentence.
- **Only the name.** Headings, buttons, labels and body copy use ordinary
  sentence case. User-written content (posts, display names) is shown as typed.
- **Tagline: "Sports talk, wired live."** Used for `<meta name="description">`
  and `og:description`. Sentence case; the name stays lowercase.

## Consequences

- Where and how the UI writes the name: `wiki/CodeContext/FrontendUI/typography.md` §3.
- The brand link's accessible name and the wordmark's `alt` are exactly
  `fanwire` (`wiki/CodeContext/FrontendUI/accessibility.md`, A13 and A19).
