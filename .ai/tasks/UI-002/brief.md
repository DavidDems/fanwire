# UI-002 — Shared components and icons

Part of the frontend styling pass planned in `wiki/CodeContext/FrontendUI/implementation-plan.md`. Run by hand from a Claude Code session (`wiki/GeneralContext/Prompts/13`–`16`), not by the orchestrator.

The building blocks every feature unit uses. No feature imports them yet:
wiring them in is each feature unit's job.

**Icons are copied, not installed.** `frontend/package.json` is forbidden, and a
dependency would need a Director PR. Copy the thirteen Lucide SVGs as small
React components and put Lucide's ISC licence in `icons/LICENSE`. Get the SVG
source from the Lucide repository (`icons/<name>.svg`) and keep the paths
unchanged.

**What is deliberately not built:** tabs, toast, modal and menu
(`components.md` §2). Don't add them.

Test classes through the module's export (`toHaveClass(styles.primary)`),
never a literal class name. CSS Module names are hashed (`verification.md`
§1).
