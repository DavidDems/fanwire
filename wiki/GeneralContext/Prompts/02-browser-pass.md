# 02 — The browser pass, and `MEDIA-002`

**Objective:** drive the real app against the real dev Cognito pool, in a
browser, for the first time. Every Cognito call sits behind the `AuthService`
seam and is covered only by an interface double, so the SDK call signatures in
`CognitoAuthService.ts` are **unverified against a live pool** — a wrong
argument shape there passes all 371 tests. Do this before any deploy.

**Read:** `00-session-protocol.md`,
`wiki/GeneralContext/Architecture/dev-auth-setup.md`, `AGENTS.md` "Build / test
/ run", and `.ai/tasks/MEDIA-002/`.

Sign up, confirm by email, sign in, create a profile, land on the feed, compose,
like, reply, clear a notification. Land `MEDIA-002` so an upload can reach
`processed`. One PR per fix.
