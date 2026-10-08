# 02 — What is left to build

**The remaining work, as of 2026-10-07.** The backend, the CDK app and every
planned frontend unit are built and live; the last unit, `FRONTEND-007`
(search), merged as #114. What follows is small follow-up work, collected from
the prompts and plan sections that found it (now deleted or trimmed), so it
lives in one list.

**How these get done next.** The project's focus is back on the automated
workflow in `.ai/`. Each item below is meant to become a task spec
(`.ai/tasks/<ID>/task.json` + `brief.md`) and run through the orchestrator,
not a hand-run session, **once `wiki/GeneralContext/Prompts/01-agent-workflow-review.md`
has run and its changes have landed**. Writing a spec is Director work. Items
marked **Director** touch paths no worker may write (`.ai/`, `.github/`,
`wiki/GeneralContext/`, `AGENTS.md`), or need a human decision first.

When an item is done, delete it here and record the result as current-state
fact in the module file it changed.

## Agent system

These are the review's input, not a separate queue: `.ai/docs/handoff.md` §9.2
lists them with what *done* means for each.

- The CI half of bug 17 (a required check that a non-`agent/*` PR touches no
  `.ai/tasks/*/state.json`).
- Unhandled `workflow_run` conclusions in the orchestrator.
- Concurrency can drop a transition (handoff §5.4).
- The provider CLI is installed unpinned on every run (handoff §5.6).
- `action_required` on bot-authored PRs: decide and write it down.
- The `jev` decision layer: rebase `jev-decision-layer` (270 commits behind
  `main`), switch it to the direct TypeSafe route, and earn the merge
  precondition (one 200 with a `confidence` field). **Director.**

## Backend and infra

| Item | Where it came from | Notes |
|---|---|---|
| **`MEDIA-002`**: the dev-only processing script, so a local upload reaches `processed` without GuardDuty | `.ai/tasks/MEDIA-002/` (spec exists) | Ready to run |
| **`lambda-vpc-eni` self-deny**: a `Deny` on the ENI actions conditioned on `lambda:SourceFunctionArn` (`ArnLike` `Fanwire-App-*`) in `backendFunction` | `0x00-architecture.md` → the `lambda-vpc-eni` waiver | Check how `infra/test/iam-policy.test.ts` treats a `Deny`. Proven only by a deploy plus a logged-in `/api/users/me` |
| **DLQ-depth alarms**: one CloudWatch alarm per DLQ on `ApproximateNumberOfMessagesVisible > 0`, in `messaging-stack.ts` | the runbook's known gap | Grows the CloudFormation exec policy (`cloudwatch:*`, and `CloudWatch` in `cfn-exec-policy.test.ts`'s `TYPE_TO_IAM`); the human rolls the policy out **before** the deploy. **Where it notifies is a human decision** (SNS → email); build the alarm first |
| **Local notifications**: the dev stack never creates any, because without `POST_EVENT_BUS_NAME` events go to `InMemoryEventPublisher` and nothing consumes them | `UI-005`–`UI-007` browser pass | Dev tooling. Until then, `FrontendUI/verification.md` §3a says how to insert rows |
| **Team abbreviations on `LiveScoreView`**, so the feed's score block can name teams instead of "Home" and "Away" | `components.md` §4 | `feed/` backend, then a frontend unit |

## Frontend

| Item | Where it came from | Notes |
|---|---|---|
| **No sign-out control anywhere.** `useAuth().signOut` works; nothing calls it | `UI-004`/`UI-008` browser pass | A "Sign out" button in the shell header for signed-in visitors. Writes `src/routes/**` |
| **Email toggle while email is off.** "Email me about new notifications" still renders and does nothing | `0x05-notifications.md` → "Email is off in production" | Keep storing the preference; caption or disable it. Prefer the backend saying whether email is available (a field on the preference response) over a build-time flag |
| **Compose: drop the separate *Attach* click.** Upload → wait for the scan → click *Attach* | the human, 2026-09-30 ("a bit annoying") | The wait for `Processed` stays; only the click goes. `features/compose/` |
| **"1 followers", "1 likes"**: singular and plural | `UI-005`, `UI-008` browser passes | The counts are pinned exactly by tests, so each is a behaviour change with its own red test (`features/profile/`, `features/feed/`) |
| **`Badge neutral` is invisible on the score band**: both use `--color-surface-muted`, so "Final" loses its pill | `UI-005` browser pass | `components/ui` (Badge or `GameScore`), so its own unit |
| **"Your profile" clips in the bottom bar** at 360 px with a classic scrollbar (345 px of content) | `UI-005`–`UI-007` browser pass | Shell, `src/routes/**` |
| **The shell's `scroll-padding-bottom` is about 5 px short**: a focused control near the bottom bar is overlapped (never hidden) | `FRONTEND-007` browser pass | Shell, `AppLayout.module.css` |
| **`Field` layouts**: a checkbox layout (then delete `EmailPreference`'s `.preference > div` exception) and a row layout (so search's box and button, and its three selects, can sit in a row) | `components.md` §5, `FRONTEND-007` | `src/components/` |
| **`fetchTeams` exists in four places** (profile, `ProfileSetupPage`, `MentionAutocomplete`, search), sharing one cache key | `FRONTEND-007` | Move into `api/`; needs all four features in scope |
| **The media-URL join exists twice** (`features/feed/api.ts`, `features/compose/MediaWidget.tsx`) | `FRONTEND-005` | Move into `api/` or `components/`; needs both in scope |
| **A username character rule** (look-alike usernames) | `typography.md` §1 | A product decision first. **Director** |

## Features in `business-rules.md` that are not built

- **The game stats page.** "Posts with a link to a game should be clickable
  to go to the stats page." Once it exists, `#GameId<n>` in post text becomes
  a link styled as an inline `neutral` badge (`components.md` §4).
- **The post menu** (report, copy link). Use the native `<dialog>` and the
  Popover API before considering a dependency (`components.md` §2).
