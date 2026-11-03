# 22 — Launch adjustments: ten units before the site goes public

**Brief for hand-run sessions** (one unit per session, on `agent/<ID>`, held by
`agent-guard`), plus two small Director steps. Self-contained: read this file, then
the one spec you are running.

**Objective:** the human is about to share fanwire on LinkedIn and with friends and
recruiters (2026-11-02). These ten units are the last product changes before that.
They are recorded in `Architecture/human-decisions.md` §10 and §5, and they close
the `TODO/02-backlog.md` section "Launch adjustments".

## Read first, in this order

1. `Architecture/director-sessions.md`: the hand-run loop, the guard per commit,
   the browser rows.
2. `.ai/tasks/<ID>/task.json` and `brief.md` for the unit you are running. The
   brief's "Decided" section records choices made while specifying, so do not
   re-ask them.
3. `TODO/02-backlog.md` "Launch adjustments": the order.

## Where things stand (2026-11-02)

- All ten specs are on `main` (this brief's PR). None is started. Check with
  `python .ai/bin/agentctl.py status` and `gh pr list`.
- Nothing else open touches `frontend/` or `backend/` except Renovate.

## Order and why

Each unit is cut from a `main` that contains the one before it. The three chains
share files such as `AppLayout.tsx`, so units run one at a time, not in parallel.

1. **`EVENTS-011`**: value shapes. Ships alone.
2. **`EVENTS-012`**: the library. Adds a migration.
3. **`FRONTEND-030`**: the records home and search.
4. **`FRONTEND-031`**: team icons. The palette is in its brief.
5. **`USERS-005`**: avatar colours. Needs `FRONTEND-031`'s palette, and adds a
   migration.
6. **`POSTS-008`**: History. Its menu entry arrives in 7. Adds an index-only
   migration.
7. **`USERS-006`**: the account menu and Account settings, with the server-checked
   password on deactivate.
8. **`USERS-007`**: sign-up without verification. Only after 7 is in production,
   since 7 is how an unverified account verifies.
9. **Director step, then `USERS-008`**: delete my data. See the manual steps.
10. **`FRONTEND-032`**: Invite. Small, and can go anywhere after 7.

## Manual steps for the human

In order, each when its unit reaches it.

1. **After each deploy that adds a migration** (`EVENTS-012`, `USERS-005`,
   `POSTS-008`, `USERS-008`): approve the deploy only when you can run the
   migration straight away, then run `Migration` as in `build-deployment.md` "Run
   migrations". Until it runs, `EVENTS-012`'s and `USERS-005`'s new code fails on
   the affected routes; `USERS-005`'s gap affects every profile read.
2. **Before `USERS-007` starts**: on the dev pool, attach a pre sign-up trigger
   that sets `autoConfirmUser`, and provide one fresh `+alias` test address. The
   unit's brief, "Prove first", lists what the session then checks. Agents hold no
   `cognito-idp:Admin*`.
3. **Before `USERS-008` starts**: a Director PR adds `cognito-idp:AdminDeleteUser`
   to `infra/iam/fanwire-role-boundary-policy.json`. After it merges, you apply the
   new policy version to `FanwireRoleBoundary` in AWS as `infra/iam/README.md`
   describes, because `deploy.yml` checks that the live policy matches the
   repository's.
4. **After `USERS-007` deploys**: create one account through the real sign-up page
   to confirm that sign-in works with no code.

## How the human wants the work done

- Test-first, with the failing tests in a commit of their own, and browser rows
  reported row by row, or NOT DONE.
- Each PR body names its deploy steps from the list above.
- Run `/security-review` on `USERS-006` and `USERS-008` before opening their PRs.

## Recorded risks, accepted by the human

- **Team colours**: `branding.md` §10 lists a team's colour pair as a hazard. The
  human chose icons anyway, with no logos (`human-decisions.md` §5).
- **Sign-up without verification**: an unverified account cannot reset its
  password, and an address can be registered by someone who does not own it
  (`USERS-007` brief).
- **Cognito's default email sender** (`infra/lib/auth-stack.ts`) has a low daily
  quota. Verification codes now go out only when someone presses Verify, so the
  quota is reached later. Moving it to SES is not in these units.

## Mechanics learned the hard way

- Parallel sessions share the main checkout: work in a worktree
  (`project_shared-checkout-sessions`).
- Run the full suite on the combination when two PRs are open, because
  tree-scanning tests trip each other.
- Use dev server ports 5210–5219 with `--strictPort`, and stop only the port you
  started.
