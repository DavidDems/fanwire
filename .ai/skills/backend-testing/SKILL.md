---
name: backend-testing
description: How fanwire's backend test suite is laid out and run. Load for any task that adds or changes tests under backend/tests/.
---

# Backend testing

## Running

```
docker compose run --rm backend-test          # what CI runs; use this to verify
cd backend && .venv/Scripts/python -m pytest tests/   # fast local loop
```

CI is authoritative. A local pass is a hint, not a result.

## Layout

`backend/tests/<module>/test_<unit>.py`, mirroring `backend/app/<module>/`.
Modules: `users`, `events`, `posts`, `media`, `notifications`, `feed`. Tests
that cross no module boundary live at `backend/tests/test_*.py`.

Put a new test in the directory of the module whose behaviour it pins, not the
directory of the module it happens to import.

## conftest.py — read before adding a test file

`backend/tests/conftest.py` imports every module's `models` up front, because
SQLAlchemy's `Base.metadata` is process-global and populated by import side
effect. Without it, a test file that calls `Base.metadata.create_all()` after
importing only its own module's models fails with
`NoReferencedTableError: could not find table 'media'` — and passes in the full
suite only by accident of alphabetical collection order.

If you add a module with SQLAlchemy models, add its import there too. If your
new test file fails in isolation but passes in the suite, this is why.

## Configuration

`pyproject.toml` sets `asyncio_mode = "auto"`, so async tests need no
`@pytest.mark.asyncio`. `testpaths = ["tests"]`.

## Available fixtures and fakes

- `moto` for AWS (`s3`, `dynamodb`, `events`, `secretsmanager`, `ses`, `sns`) —
  mock AWS, do not reach a real account.
- `testcontainers[postgres]` for tests that need real Postgres rather than
  SQLite behaviour.
- `freezegun` for TTL and idempotency-key tests.
- `factory-boy` + `faker` for model fixtures.
- `httpx` / FastAPI `TestClient` for route tests.

Prefer an existing fixture over a new one; check the module's sibling test
files first.

## Writing the failing test first

The workflow commits your tests and runs CI on them *before* any
implementation exists. That run is expected to be RED, and the orchestrator
treats a GREEN baseline as a failure: it means the test does not actually pin
the behaviour the task is about. So:

- Write the test against the intended interface even when the module, class or
  method does not exist yet. An `ImportError` at collection time is a
  legitimate red baseline.
- Assert the specific behaviour in the acceptance criteria, not that the code
  merely runs.
- Do not write a test that passes against today's code.

## Lint

`ruff` with `line-length = 100`, and `mypy --strict` over `app` (not over
`tests`). Both run in CI. `python -m ruff check .` and `python -m ruff format`
before committing.
