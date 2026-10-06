# UI-008 — Profile

Part of the frontend styling pass planned in `wiki/CodeContext/FrontendUI/implementation-plan.md`. Run by hand from a Claude Code session (`wiki/GeneralContext/Prompts/13`–`16`), not by the orchestrator.

`ProfileSummary` takes three scalars, never a user object, and that's the
privacy guarantee for date of birth (`0x08-frontend.md`). Adding the avatar
must not change its props to a user object: pass the username it already
has.
