---
type: decision
---

# 0035 - Direction and outstanding-work answers

Decision: 2026-11-17, the human, answering the Director's review of every
documented but unbuilt item after the repository cutover.

## Context

After CUT-12 the Director listed what the docs plan but nothing builds. Many
rows were open questions, "needs a decision" notes or ideas without a design.
The human answered each. This ADR is the one owner of those answers; the
backlog, briefs and module files link here.

## Choice

**Direction.** The project is the best sports social app the human can build,
with full control of deployment and configuration and no third-party hosting
provider. The agent pipeline serves that goal; it is no longer the objective
(this supersedes the focus recorded in [ADR 0027](0027-work-modes.md) and the
"real objective" of `.ai/docs/philosophy.md` §2). API calls cost too much for
development, so development stays hand-run: the human prompts agents to write
tracks and specs, then prompts agents to build them under the CI restrictions.
Work is organised as the ordered **Outstanding-work tracks**
(`wiki/GeneralContext/Prompts/30-*` onward), run one after another.

**Priority.** The first track is the automated Kaggle refresh (`EVENTS-008`):
download the NBA dataset and load it with no manual step. Its gate ("the
dataset must resume updating") is lifted, since the human wants it built now.

**Parked for cost.** The items that need metered API runs to build or prove are
parked, not scheduled: agent evals (`Prompts/12`), the worker shell (`13`), the
learning loop (`14`), the context graph (`15`), exercising a failure path on
purpose (backlog item 15), the `acceptEdits` question (item 17) and proving the
cheap automations live (item 14). Revisit only if the human chooses to spend.
The deterministic, key-free pipeline items stay (metrics, local guards, a
base-is-`main` check).

**Wiki and `.ai/` reviews.** No scheduled run and no `wiki-health.yml`. Two
project skills (`wiki-review`, `ai-review`) and two copy-pastable prompts that
the human runs by hand about weekly. The final track builds them; the human
runs both once the other tracks are done. This replaces `Prompts/10`
deliverable 4 and the two "weekly review" ideas.

**Account lifecycle (Track D).**
- It is a security requirement, not a wanted feature, so it comes after the
  user-facing work. The human wants it finished.
- `AUTH-001` shrinks to what the project's AWS limits allow: Cognito's native
  forgot-password flow with its verified-email code and a static reminder to
  verify. No custom reset tokens, no SES, no paid pool plan, no revocation-
  evidence machinery; `USERS-009`'s fencing covers deletion.
- `AUTH-002` and `AUTH-003` are dropped. A new-device challenge that withholds
  tokens until success needs a custom Cognito auth-challenge flow and a way to
  send its email; Cognito's default sender cannot be called from a Lambda, and
  SES, email MFA and the paid plan are all ruled out. NIST also says email is
  not an acceptable out-of-band authenticator, so the result would be weak
  assurance at high cost. Revisit only with TOTP or passkeys, as a new decision.

**Product answers.**
- **Usernames** follow Instagram's rule: 1–30 characters, ASCII letters,
  digits, underscore and period; no `..`; no trailing period. The pattern is
  `^(?!.*\.\.)(?!.*\.$)\w[\w.]{0,29}$`, matched whole-string and ASCII-only
  (no multiline flag, and `\w` must not match other scripts, or look-alikes
  return). Existing usernames that break it need a decision in the unit.
- **The email toggle** while email is off is fixed by a backend field on the
  preference response saying whether email is available, not a build-time flag.
- **The API-SPORTS leftovers** are deleted outright: the two `RETAIN`
  resources are `IdempotencyTable` (DynamoDB) and `ApiSportsKey` (a secrets
  placeholder), which no deployment path uses. The human deletes them after
  the clean-up deploys.
- **Renovate**: the Director's order. Merge the non-major and Actions groups
  first, then one major per PR with its tests, the toolchain majors before the
  UI ones; `typescript` 7, `vite` 8 and React's major go last, each alone.
- **AWS-limit questions** answered "most sensible": native Cognito only.

## Consequences

- Backlog, `AGENTS.md`, the index, Prompts 06, 10 and 22, `TODO/01-for-you.md`
  and `typography.md` point here instead of holding their own open question.
- `AUTH-002` and `AUTH-003` leave the backlog. Their task directories stay;
  a task's state changes only through its own task branch.
- The Outstanding-work tracks are the order of work until none is left.
