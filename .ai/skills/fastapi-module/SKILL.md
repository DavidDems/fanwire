---
name: fastapi-module
description: The file-per-concern shape every fanwire backend module follows, and the boundary rule between modules. Load for tasks touching backend/app/.
---

# FastAPI module shape

Every module under `backend/app/<module>/` splits the same way. Put new code in
the file that already owns that concern rather than inventing a new one:

| File | Holds |
|---|---|
| `models.py` | SQLAlchemy models. Bigint identity PK, never UUID. |
| `schemas.py` | Pydantic request/response models. |
| `routes.py` | FastAPI routers. Thin: validate, delegate, serialise. |
| `service.py` | Business logic. |
| `dependencies.py` | FastAPI `Depends` providers for this module. |
| `interfaces.py` | The contract other modules are allowed to use. |

Not every module has every file. `feed/` and `search/` own no tables at all —
they compute over other modules' data through those modules' interfaces.

## The connection rule

A module never reaches past another module's interface into its concrete
classes or tables. Cross-module references are by ID or through the interface
the other module publishes. This is the rule most likely to make a reviewer
reject an otherwise-working diff, and `wiki/CodeContext/Modules/0x00-architecture.md`
is its source of truth.

`PostEventBus` (EventBridge) is the one domain event bus for the whole
application, despite living under `posts/`. Publish domain events there rather
than calling another module directly.

## Conventions that bite

- **Bigint identity primary keys.** Not UUIDs, on every table.
- **`Depends()` in a default argument is deliberate** — it is FastAPI's own
  idiom, and `pyproject.toml` already exempts it from ruff's B008. Do not
  "fix" it.
- **Validate at the boundary only.** Parse into a Pydantic schema at the route,
  then trust the typed object inward. No defensive re-validation in services.
- **Config comes from the environment** through `app/settings.py`
  (pydantic-settings). No literals, no module-level `os.environ` reads.
- **`mypy --strict` runs over `app`.** Annotate fully; a bare `Any` will fail CI.

## Adding a dependency

You cannot. `backend/pyproject.toml` is denied to the code agent in
`.ai/policy.json`: adding a package is a supply-chain decision, not something a
retry loop settles on attempt three. Solve it with what is installed, or stop
and report that the task needs a dependency the Director has to approve.
