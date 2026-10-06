# UI-006 — Composer

Part of the frontend styling pass planned in `wiki/CodeContext/FrontendUI/implementation-plan.md`. Run by hand from a Claude Code session (`wiki/GeneralContext/Prompts/13`–`16`), not by the orchestrator.

The mediator's isolation is enforced from disk: no compose control imports
another. Styling must not change that. Each control gets its own module CSS.

The suggestions stay a list of plain buttons, not a combobox (the file says
why). The file input keeps no `accept` attribute (`0x08-frontend.md`); style
its button with `::file-selector-button`.
