---
type: runbook
---

# FrontendUI — browser verification

Part of [verification.md](verification.md). What only a real browser can show,
how an agent drives one, and how a unit reports it.

## 3. What needs a browser (B)

[ADR 0022](../../GeneralContext/Decisions/0022-browser-verification-on-hand-run-sessions.md) stands: **browser verification is reported as NOT DONE
unless a tool or a human really drove the app.** A unit's PR never says "looks
good" on the strength of passing tests.

**Where:** `npm run dev` in `frontend/` against `backend-dev` (`AGENTS.md`
"Build / test / run"), or the live site after the deploy. Seed data:
`docker compose exec backend-dev python scripts/seed_dev.py`.

### 3a. Agent-driven checks: Playwright MCP

A local Claude Code MCP server, installed once by the human:

```powershell
claude mcp add playwright -- npx @playwright/mcp@latest
```

It isn't a repo dependency and isn't in CI. It is available to a hand-run
Director session; dispatched workers don't have it. A row it really checked
counts as done: report it as "✅ Playwright MCP, Chromium, <date>" with what was measured.

- **What it can drive:** viewport size (`browser_resize`: 360 and 1280 wide),
  light and dark mode, forced colours and reduced motion
  (`browser_emulate_media`), screenshots, the accessibility tree
  (`browser_snapshot`), and computed styles through `browser_evaluate`. With
  those, an agent can measure a contrast ratio from the computed `color` and
  `background-color`, and check `scrollWidth == clientWidth` for horizontal
  overflow.
- **What to point it at:** a local `npm run build` then
  `npx vite preview --port <n> --strictPort` from the unit's worktree. That's the
  production bundle, which needs `frontend/.env.local` copied into the worktree;
  never commit it. The live site is fine for read-only looks after a deploy.
  Stop the preview server afterwards, and only that one: stop the process that
  owns your own port, never one found by its command line, because a leftover
  server locks `esbuild.exe` so its worktree can't be removed.

  ```powershell
  Stop-Process -Id (Get-NetTCPConnection -LocalPort <n> -State Listen).OwningProcess
  ```
- **Files:** screenshots and snapshots may only be written under the repo root
  (the server's allowed roots), so use `.playwright-mcp/`, which is gitignored.
  Read a screenshot back to look at it.
- **The browser profile persists between sessions and is visible on screen.**
  Whatever the human types into that window, a sign-in included, can still be
  there next time. An agent never submits credentials it was not given, and
  never acts on the live site as a signed-in user.
- **Not covered:** axe, because there is no axe dependency and loading it from a
  CDN would put a third-party script into the check. The axe row stays NOT DONE
  until the human runs the axe browser extension. 
- **Signed-in states** use the two dev-pool test accounts (`fwtest1` and
  `fwtest2`), whose credentials are in the untracked
  `frontend/.env.test-accounts.local`. How to start the stack, recreate their
  profiles after a `docker compose down`, and sign out (the nav's Sign out)
  is in `wiki/GeneralContext/Architecture/dev-auth-setup.md`
  "Test accounts". Use them against `npm run dev` with `backend-dev` only,
  never the live site, and sign out at the end, because the browser profile
  persists. Two accounts make "someone else's profile" and following
  checkable.
- **What the checks have taught.** A newcomer
  signed in on a fresh stack lands on the feed, not `/create-profile` (the
  feed is public): go to `/create-profile` yourself, and expect no "Your
  profile" nav link until the profile exists. `browser_run_code_unsafe` runs
  in a sandbox with no `import`, so it can't read files: read the account file
  with the Read tool and pass the values in. A date input takes three Tab
  stops in Chromium (day, month, year), so a script that reads the outline per
  stop can report a false "no ring"; look at it before calling it a defect.
  The keyboard script's own header links are not "under the header".
  - **Notifications come from real actions** (`NOTIFICATIONS-001`).
    `backend-dev` sets `ENVIRONMENT=development`, so a follow, reply or repost
    creates its row in process, through the consumer production uses. Have a
    second account act on the first, and don't insert rows by hand. No email
    goes out. A consumer failure doesn't fail the request, so if a row is
    missing, look for `local notification dispatch failed` in `docker compose
    logs backend-dev`.
  - **A new account's signed-in feed is empty** until it follows someone
    (the backend ranks by follows and preferred team). Reach the other
    account by `/profile/<id>`.
  - **A screenshot taken right after switching the colour scheme can catch
    a transition half-way**, and enabled buttons look disabled. Wait a
    moment, or read `disabled` and the computed colours before calling it a
    defect.
  - **A full-page screenshot draws the sticky header and fixed bar in the
    middle of the image.** That's the capture, not the layout.
  - **Media states past "wrong type" need an upload that reaches the bucket**,
    which `backend-dev` doesn't give you. Report preparing, ready, rejected
    and too large as covered by tests only.

**The per-unit checklist.** Every styling unit's PR body carries this table for
the routes it touched, filled in or marked NOT DONE:

| Check | Light | Dark | How |
|---|---|---|---|
| 360 px wide: nothing overflows horizontally; bottom bar doesn't cover content (A9) | | | DevTools device mode |
| 1280 px wide: 640 px column, header nav (layout) | | | |
| Keyboard only: every control reachable, ring visible, never hidden under the header (A3, A5) | | | Tab through |
| 200 % zoom reflows (A9) | | | Ctrl + |
| Reduced motion: nothing moves (A8) | | | OS setting or DevTools rendering emulation |
| Forced colors: focus, button edges and current nav visible (A20) | | n/a | Windows contrast theme or DevTools emulation |
| Targets ≥ 24 px; primary and nav ≥ 44 px (A6) | | | DevTools inspector |
| axe DevTools: 0 serious or critical on the route | | | Browser extension; paste the count |

Each row is ✅, ❌ (with what was seen), or **NOT DONE**, plus who checked it,
in which browser and OS, on which date. Unfilled means NOT DONE.

**Gates:** `npm test`, `npm run typecheck`, `npm run lint` and
`npm run build`, then `docker compose run --rm frontend-test`
(`wiki/GeneralContext/Architecture/director-sessions.md`). A local pass is a hint; the container is the
result.
