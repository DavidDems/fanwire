---
type: decision
---

# 0022 - Browser verification on hand-run sessions

Decision: 2026-10-06, the human.

## Context

Passing unit tests do not show what a page renders, and a report that a page
"looks right" is worth nothing unless something really drove it. Dispatched
workers and CI have no browser.

## Choice

- **Playwright MCP, as a local Claude Code MCP server.** The human installed it
  with `claude mcp add playwright -- npx @playwright/mcp@latest`.
- **Only hand-run Director sessions use it**, against `npm run dev` or
  `vite preview` on localhost, signed in only with the two dev-pool test
  accounts.
- **A row it really drove counts as done.**
- **It is not a repository dependency and not in CI**, so dispatched workers
  have no browser.
- **Anything a tool or a human did not really drive is reported as NOT DONE.**
  axe stays NOT DONE until the human runs the browser extension.

## Consequences

- How a session uses it, and how it gets rows for a check, are
  `verification-browser.md` §3a
  ([browser verification](../../CodeContext/FrontendUI/verification-browser.md)).
  The test accounts are
  [dev-auth-setup.md](../Architecture/dev-auth-setup.md) "Test accounts"
  ([ADR 0020](0020-real-aws-services-for-local-development.md)).
- A unit that touches the UI and runs through the automated pipeline reports
  its browser rows as NOT DONE.
