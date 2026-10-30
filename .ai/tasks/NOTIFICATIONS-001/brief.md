# NOTIFICATIONS-001: notifications on the local stack

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why

`TODO/02-backlog.md` "Local notifications". Without `POST_EVENT_BUS_NAME`,
`get_event_bus` wires `InMemoryEventPublisher`, which records events and delivers
them to nothing. In production, EventBridge, SQS and the Lambda call
`handle_domain_event`, so locally no notification is ever created, and browser
checks insert rows by hand (`FrontendUI/verification.md` §3a).

## The design

- **A third `EventPublisher`**, in `app/notifications/local_dispatch.py`. It
  stands in for EventBridge, SQS and the Lambda, and calls the same
  `handle_domain_event`. Observer stays as `gof-patterns.md` assigns it: `posts/`
  and `users/` publish to the bus and know nothing of the subscriber. `app/eventbus.py`
  stays pure infrastructure, importing no module.
- **Wired only in `get_event_bus`**, the composition root, which injects a session
  factory (`open_session`), so `local_dispatch.py` needs no `app.dependencies`
  import. There is no cycle today: nothing `consumer.py` imports reaches
  `app.dependencies`. Keep it that way.
- **An explicit opt-in: `ENVIRONMENT=development`**, the exact value the dev
  scripts already require (`scripts/dev_process_media.py`). The `Settings`
  validator follows `_perf_jwks_only_in_perf`.
- **Rejected: dispatch by default when the bus name is empty.** It needs no compose
  change, but a deployed function missing its bus name would then depend on
  detecting Lambda to stay safe, and `backend-perf` would start writing rows.
- **Email:** an `EmailSender` in `local_dispatch.py` that sends nothing. Do not
  reuse `SesEmailSender`: a developer's `.env` could set a from-address and send
  real mail.

## Traps

- **`docker-compose.yml` is denied to every unit role**, so this unit cannot turn
  its own switch on. Until a Director PR adds `- ENVIRONMENT=development` to
  `backend-dev`, the feature is off and the dev stack behaves as today. For the
  browser check, put the line in the untracked `backend/.env`. Use `KEY=value`
  form: `.ai/tests/test_dev_compose.py` refuses a bare name.
- **Later Director PR, not this spec:** that compose line, the `verification.md`
  §3a change (`FrontendUI/` is not unit-writable) and the backlog row. Merge order
  between them does not matter: the switch alone is inert until the code exists.
- **Publish runs after commit** at both notifying sites (`PublishPostFacade`,
  `users.service.follow`), so a new session sees the row, and the repost advisory
  lock is already released. Pin it with the route-level tests.
- **A failure must not fail the request**, because in production the consumer is
  asynchronous. This is the one place local behaviour needs a catch.
- **No redelivery locally:** at most once, which is fine for dev tooling. Don't
  build a retry.
- **`get_settings` and `get_event_bus` are `lru_cache`d:** clear them in tests, as
  `tests/test_dependencies.py` does.
- **`ENVIRONMENT=development` in `backend-dev`** also lets the dev scripts run
  there without `-e`. That is intended.

## Not in this task

Any production path, and `POSTS-007` (the missing-post no-op). They touch the
same consumer only by call, and this unit does not edit `consumer.py`.
