# UI-005 — Feed, posts and the live score

Part of the frontend styling pass planned in `wiki/CodeContext/FrontendUI/implementation-plan.md`. Run by hand from a Claude Code session (`wiki/GeneralContext/Prompts/13`–`16`), not by the orchestrator.

The moment that matters most: a post about a live game (`direction.md`).

**The decorator adds a block and never restyles what it wraps.** That's the
pattern's whole point (`gof-patterns.md`, and the file's own header). Put the
ticker after the children. Never wrap the children in a styled container.

**"No replies yet." is a behaviour change**, the only one in the styling pass.
It's red today because an expanded post with no replies renders nothing.
Record it in `0x08-frontend.md`.

`LiveScoreView` has no team names, so the score block says Home and Away. Don't
fetch teams to name them: that's a backend follow-up
(`components.md` §4).
