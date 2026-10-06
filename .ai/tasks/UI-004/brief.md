# UI-004 — Auth pages

Part of the frontend styling pass planned in `wiki/CodeContext/FrontendUI/implementation-plan.md`. Run by hand from a Claude Code session (`wiki/GeneralContext/Prompts/13`–`16`), not by the orchestrator.

Styling only. No auth logic changes, which is why the service, context and
token-provider files are forbidden. Native form controls are already styled
by `base.css` from their existing `aria-invalid` and `:disabled` state
(`components.md` §1), so most of this unit is the card, the alerts and the
buttons.

If a shared component is missing something this unit needs, stop and report
it. `src/components/ui/**` is forbidden here: a feature unit consumes the
components, it doesn't restyle them.
