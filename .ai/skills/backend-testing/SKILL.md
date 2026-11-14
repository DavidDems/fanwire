---
name: backend-testing
description: How fanwire's backend test suite is laid out and run. Load for any task that adds or changes tests under backend/tests/.
---

# Backend testing

## What runs, and who runs it

You have file tools and no shell: no `pytest`, `ruff`, `docker` or `git`, so
you never see a result before you finish. The workflow commits your diff, then
CI runs these over the whole branch, each a required job, in `backend/`:

| Job | What it runs |
|---|---|
| `backend-test` | `pytest` in the test container |
| `backend-ruff` | `ruff check .`, **`tests/` included** |
| `backend-mypy` | `mypy app` (strict; `app` only, not `tests`) |

Before finishing, re-read every file you wrote as ruff would: an unused import
costs a whole CI run.

## Layout

`backend/tests/<module>/test_<unit>.py`, mirroring `backend/app/<module>/`.
Modules: `users`, `events`, `posts`, `media`, `notifications`, `feed`,
`search`. Tests that cross no module boundary live at `backend/tests/test_*.py`.
Put a test in the directory of the module whose behaviour it pins, not of the
module it happens to import.

## conftest.py — read before adding a test file

`backend/tests/conftest.py` imports every module's `models` up front, because
SQLAlchemy's `Base.metadata` is process-global and populated by import side
effect. Without it, a test file that calls `Base.metadata.create_all()` after
importing only its own module's models fails with
`NoReferencedTableError: could not find table 'media'` — and passes in the full
suite only by accident of collection order. A new module with models needs its
import there too.

## Configuration

`pyproject.toml` sets `asyncio_mode = "auto"`, so async tests need no
`@pytest.mark.asyncio`. `testpaths = ["tests"]`.

## Available fixtures and fakes

- `moto` for AWS (`s3`, `dynamodb`, `events`, `secretsmanager`, `ses`, `sns`) —
  mock AWS, never reach a real account.
- `testcontainers[postgres]` for tests that need real Postgres rather than
  SQLite behaviour.
- `freezegun` for TTL and idempotency-key tests.
- `factory-boy` + `faker` for model fixtures.
- `httpx` / FastAPI `TestClient` for route tests.

Prefer an existing fixture; check the module's sibling test files first.

## Writing the failing test first

CI runs your tests *before* any implementation exists, and that run must be
RED. A GREEN baseline is a failure: the test does not pin the behaviour.

- Write against the intended interface even when the module, class or method
  does not exist yet. An `ImportError` at collection time is a legitimate red.
- Assert the specific behaviour in the acceptance criteria, not that the code
  merely runs.
- A ruff finding in your test file is never the right red. The code agent
  cannot edit tests, so it sends the task to the manager instead.

## ruff: what a test file must pass

`pyproject.toml` selects no rules, so CI runs ruff's own default set, which in
the version CI installs is broad. What test files trip:

- `F401`/`F841`/`RUF059`: an unused import, variable, or unpacked name
  (prefix it `_`).
- `I001`: imports sorted — stdlib, third-party, then first-party (`app`,
  `tests`, `scripts`), a blank line between groups, alphabetical, `import x`
  lines before `from x import y` lines in each group.
- `UP`: `list[int]`, `dict[str, X]`, `X | None`, `datetime.UTC`; never
  `typing.List`/`Optional`/`Union`.
- `DTZ`: no naive `datetime.now()`, `utcnow()` or `date.today()`; use
  `datetime.now(UTC)`. This holds under `freezegun` too.
- `B017`/`PT010`: `pytest.raises` names a specific exception, never bare
  `Exception` or nothing.
- `B018`: no bare expression statement (an attribute access "to check it
  exists" — assert on it instead).
- `E722`/`BLE001`/`S110`: no bare or blind `except`, no `try/except: pass`.
- `SIM117`: one `with a, b:`, not nested `with`s.
- `RUF012`: a mutable class attribute is annotated `ClassVar`.
- `PLR0402`: `from pkg import mod`, not `import pkg.mod as mod`.
- `RUF100`: no `# noqa` that suppresses nothing. Do not add `noqa` at all.

Format in ruff's style (CI does not check it): 100 columns, 4 spaces, double
quotes, a trailing comma wherever a call or literal breaks across lines.
`mypy --strict` covers `app`, not tests, but annotate test helpers anyway.
