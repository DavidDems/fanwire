---
type: decision
---

# 0032 - Product scope: an NBA discussion app

Decision: 2026-09-17, the human.

## Context

fanwire is the scaled-up successor to an earlier Twitter-style sports
discussion project. Two subjects were weighed: sports, or outdoor endurance
events (hiking, running, triathlon). The app needs real event data to post
about. Sports data has consistent, well-documented sources with free access.
Outdoor events do not: their results-like sources are split across
triathlon-only and registration-only providers, and hiking has no concept of
results at all.

## Choice

- **Sports, not outdoor events.** Users post about games, mention real teams
  and games, and read the games' data.
- **The earlier project's stack carries forward:** Python, FastAPI, Pydantic
  and SQLAlchemy on the backend, React and TypeScript on the frontend. The
  database moves from MySQL to Postgres.
- **Media uploads are in scope for v1**, images only, on an AWS-native pipeline
  rather than a third-party host: a presigned upload to a private quarantine
  bucket, a GuardDuty Malware Protection scan, validation and resizing, then a
  public media bucket behind CloudFront, with stricter limits than the rest of
  the app.
- **One sports-data source, no fallback built in advance.** API-SPORTS was the
  first provider. `EVENTS-003` retired it, and NBA data comes from one Kaggle
  dataset loaded into Postgres.

## Consequences

- The stack, the media pipeline and the data loading are
  [aws-stack.md](../../CodeContext/Standards/aws-stack.md); the upload security
  requirements are [security.md](../../CodeContext/Standards/security.md).
- The API-SPORTS retirement is
  [0x02-events.md](../../CodeContext/Modules/0x02-events.md) "Resolved
  decisions", and the loader is
  [0x02b-events-loading.md](../../CodeContext/Modules/0x02b-events-loading.md).
- The business rules by module are
  [business-rules.md](../Architecture/business-rules.md).
