# UI-003 — App shell and brand in the header

Part of the frontend styling pass planned in `wiki/CodeContext/FrontendUI/implementation-plan.md`. Run by hand from a Claude Code session (`wiki/GeneralContext/Prompts/13`–`16`), not by the orchestrator.

**One nav, moved by CSS, never two.** jsdom applies no media queries, so a
second nav for desktop would make every `getByRole("link", { name: "Feed" })` in
the suite find two (`layout.md` §1).

The route sweep (`routes.test.tsx`) and `nav-link.test.tsx` pin headings and
link names. Keep every accessible name. The Sign in link is a link, not a
heading, so the sweep's "no other view's heading" check is unaffected.

`brand/` is outside `frontend/`, so the copied SVGs are the only brand files
in the bundle, and the test container has no `brand/` folder: assert the
copies, never a comparison with `brand/out/` (`verification.md` §2a). The
header uses `favicon.svg`, the bolder small-size cut, as `symbol.svg`, because
it reads at 28 px.

Must not run concurrently with `FRONTEND-007`: both write `src/routes/**`.
