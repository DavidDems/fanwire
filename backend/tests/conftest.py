"""Registers every module's SQLAlchemy models on app.db.Base's shared
metadata before any test runs, regardless of which test file pytest
happens to collect/import first.

Why this exists: SQLAlchemy's declarative registry (Base.metadata) is
populated by the side effect of importing a model module, and it's
process-global, not per-test-file. Once users/'s and media/'s deferred FKs
closed (posts/ FK-closure unit), users.profile_picture_media_id gained a
real `ForeignKey("media.id")` — resolving that string FK at
Base.metadata.create_all() time requires app.media.models to have been
imported into the process first, purely for its class-definition side
effect, not because any test actually touches Media. A test file that only
imports app.posts.models (which imports app.users.models, not
app.media.models) and calls Base.metadata.create_all() directly hits
`NoReferencedTableError: ... could not find table 'media'` — confirmed:
before this file existed, `docker compose run --rm backend-test --
tests/posts/test_models.py` failed in isolation with exactly that error,
while the full suite passed only by accident of pytest's alphabetical
collection order (media/'s test files happen to import app.media.models
before posts/'s test files run). alembic/env.py already solved the same
problem for autogenerate by importing every model module up front; this
file does the same thing for the test suite, per AGENTS.md's connection-
rule spirit of "modules touch each other only through their real, already-
built interfaces" applying here at the schema-registration level too, not
just at the application-code level.
"""

import os
import re

import pytest
import sqlalchemy
from testcontainers.postgres import PostgresContainer

from app.events import models as _events_models  # noqa: F401 — registers Team/Game
from app.media import models as _media_models  # noqa: F401 — registers Media
from app.notifications import models as _notifications_models  # noqa: F401 — registers Notification
from app.posts import models as _posts_models  # noqa: F401 — Post/PostLike/EventMention/Report
from app.users import models as _users_models  # noqa: F401 — registers User/Follow

# Each import above is aliased to a distinct name (rather than this repo's
# usual `import app.x.models` form) so ruff's F401 check treats every one
# independently. With the shared `import app.x.models` form, all four
# statements bind the same top-level `app` name, and pyflakes/ruff consider
# an earlier import "used" by a later one that also touches `app` - which
# made three of the four `# noqa: F401` comments spuriously "unused"
# (RUF100) depending purely on import order, not on whether the import
# itself does anything. Distinct aliases make every noqa genuinely
# necessary and order-independent.


# --------------------------------------------------------------------- database


@pytest.fixture(scope="session")
def _postgres_server():
    """One Postgres *server* for the whole suite.

    This replaces 39 byte-identical `scope="module"` fixtures that each started
    their own `postgres:16-alpine`. Measured locally, every extra module added
    ~4.5-5.4s of container startup while the tests inside it took well under a
    second: the suite's cost scaled with the number of FILES, not with the
    amount of testing in them.
    """
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg


@pytest.fixture(scope="module")
def postgres_url(_postgres_server, request):
    """A fresh, empty DATABASE per test module, on that one shared server.

    The database is per-module, not per-suite, and that is the whole point.
    Sharing one database across modules looks like it works - every test still
    does `create_all` and `drop_all` around itself - right up until a module
    leaves a table behind. `create_all` does not make the schema match the
    metadata; it creates tables that are *not already there*. A leftover
    `users` table is silently accepted, and the next module fails on a column
    the leftover does not have.

    That is not hypothetical: it is what the first version of this fixture did,
    and `test_age_gate.py` caught it with
    `UndefinedColumn: column users.search_vector does not exist` - because
    `test_migrations.py` builds its schema with alembic rather than
    `create_all`, so the two disagree about what `users` looks like.

    `CREATE DATABASE` costs milliseconds against a running server, so this
    keeps the isolation the per-module containers were quietly providing and
    still pays for the container once.
    """
    # Keyed on the module's full path, not its basename: five modules are
    # called test_models.py. Sequential runs would survive a collision, since
    # each module drops and recreates before use, but two modules sharing a
    # database is the exact bug this fixture exists to prevent.
    name = "t_" + re.sub(r"\W", "_", request.node.nodeid).lower()[-50:].strip("_")
    admin_url = _postgres_server.get_connection_url().replace("psycopg2", "psycopg")

    engine = sqlalchemy.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text(f'DROP DATABASE IF EXISTS "{name}"'))
        conn.execute(sqlalchemy.text(f'CREATE DATABASE "{name}"'))
    engine.dispose()

    # A head migration now backfills issuer-qualified authority. DB tests use
    # a fixed, explicitly synthetic namespace rather than an empty issuer or
    # a developer's real pool. Tests without postgres_url keep normal defaults.
    namespace = {
        "COGNITO_REGION": "ca-central-1",
        "COGNITO_USER_POOL_ID": "ca-central-1_fixturepool",
        "COGNITO_APP_CLIENT_ID": "fixture-client",
    }
    previous = {key: os.environ.get(key) for key in namespace}
    from app.dependencies import get_settings

    for key, value in namespace.items():
        os.environ.setdefault(key, value)
    get_settings.cache_clear()
    yield admin_url.rsplit("/", 1)[0] + "/" + name

    engine = sqlalchemy.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(sqlalchemy.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    engine.dispose()
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    get_settings.cache_clear()


@pytest.fixture()
def lifecycle_case(postgres_url, monkeypatch):
    """USERS-009's real database and injected external systems, never AWS.

    Existing module tests retain their dormant defaults. These cases explicitly
    enable the new authority boundary and model already-adopted local profiles.
    A second connection in an SDK double can therefore inspect committed truth.
    """
    from datetime import UTC, date, datetime
    from types import SimpleNamespace

    from sqlalchemy import select

    from app import account_deletion
    from app.db import Base, make_engine, make_session_factory
    from app.dependencies import _get_session_factory, get_settings
    from app.media.models import Media, MediaStatus
    from app.users import models

    issuer = "https://cognito-idp.ca-central-1.amazonaws.com/ca-central-1_lifecycle"
    monkeypatch.setenv("DATABASE_URL", postgres_url)
    monkeypatch.setenv("COGNITO_REGION", "ca-central-1")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "ca-central-1_lifecycle")
    monkeypatch.setenv("COGNITO_APP_CLIENT_ID", "lifecycle-client")
    monkeypatch.setenv("ACCOUNT_LIFECYCLE_ENABLED", "true")
    monkeypatch.setenv("ACCOUNT_LIFECYCLE_CUTOVER_AT", "2026-01-01T00:00:00Z")
    monkeypatch.setenv("MEDIA_QUARANTINE_BUCKET", "lifecycle-quarantine")
    monkeypatch.setenv("MEDIA_PUBLIC_BUCKET", "lifecycle-public")
    get_settings.cache_clear()
    _get_session_factory.cache_clear()
    settings = get_settings()
    engine = make_engine(postgres_url)
    Base.metadata.create_all(engine)
    factory = make_session_factory(engine)
    calls = []

    class Objects:
        def __init__(self):
            self.values = set()
            self.fail = False
            self.partial = False
            self.before_delete = None

        def delete_objects(self, *, Bucket, Delete):
            if self.before_delete is not None:
                self.before_delete(Bucket, Delete)
            calls.append(("s3", Bucket, tuple(x["Key"] for x in Delete["Objects"])))
            if self.fail:
                raise RuntimeError("external secret that must not be retained")
            errors = []
            for index, item in enumerate(Delete["Objects"]):
                if self.partial and index == 0:
                    errors.append({"Key": item["Key"], "Code": "AccessDenied"})
                else:
                    self.values.discard((Bucket, item["Key"]))
            return {"Deleted": Delete["Objects"], "Errors": errors}

        def delete_object(self, *, Bucket, Key):
            self.values.discard((Bucket, Key))
            calls.append(("s3_one", Bucket, Key))
            return {}

        def put_object(self, *, Bucket, Key, **_kwargs):
            self.values.add((Bucket, Key))
            calls.append(("put", Bucket, Key))
            return {}

    class IdentityProvider:
        def __init__(self):
            self.fail = False
            self.missing = False
            self.before_delete = None
            self.created_at = datetime(2025, 1, 1, tzinfo=UTC)
            self.returned_sub = None
            self.lookup_fail = False

        def admin_get_user(self, *, UserPoolId, Username):
            assert UserPoolId == settings.cognito_user_pool_id
            calls.append(("cognito_get", UserPoolId, Username))
            if self.lookup_fail:
                raise RuntimeError("private lookup diagnostic")
            return {
                "Username": Username,
                "UserCreateDate": self.created_at,
                "UserAttributes": [{"Name": "sub", "Value": self.returned_sub or Username}],
            }

        def admin_delete_user(self, *, UserPoolId, Username):
            from botocore.exceptions import ClientError

            if self.before_delete is not None:
                self.before_delete(UserPoolId, Username)
            calls.append(("cognito", UserPoolId, Username))
            if self.fail:
                raise RuntimeError("provider diagnostic private@example.com")
            if self.missing:
                raise ClientError({"Error": {"Code": "UserNotFoundException"}}, "AdminDeleteUser")
            return {}

    objects, provider = Objects(), IdentityProvider()
    from app.users.dependencies import get_cognito_client

    get_cognito_client.cache_clear()

    def external_client(service_name, **_kwargs):
        if service_name == "cognito-idp":
            return provider
        if service_name == "s3":
            return objects
        raise AssertionError(f"unexpected external client {service_name}")

    monkeypatch.setattr("boto3.client", external_client)

    def seed(suffix="owner", *, state="active", with_media=True):
        with factory() as session:
            user = models.User(
                cognito_sub=f"lifecycle-sub-{suffix}",
                username=f"lifecycle_{suffix}",
                date_of_birth=date(1990, 1, 1),
                deleted_at=datetime(2026, 1, 2, tzinfo=UTC) if state == "inactive" else None,
            )
            session.add(user)
            session.flush()
            authority = models.AccountAuthority(
                issuer=issuer,
                cognito_sub=user.cognito_sub,
                state=state,
                generation=1,
                inactive_at=user.deleted_at,
            )
            session.add(authority)
            if with_media:
                media = Media(
                    uploader_id=user.id,
                    s3_key_quarantine=f"uploads/{suffix}/original.jpg",
                    status=MediaStatus.UPLOADED,
                )
                session.add(media)
                session.flush()
                objects.values.add((settings.media_quarantine_bucket, media.s3_key_quarantine))
                media_id = media.id
            else:
                media_id = None
            session.commit()
            return SimpleNamespace(
                user_id=user.id, sub=user.cognito_sub, authority_id=authority.id, media_id=media_id
            )

    def delete(sub):
        with factory() as session:
            return account_deletion.delete_account_data(
                session,
                cognito_sub=sub,
                user_pool_id=settings.cognito_user_pool_id,
                quarantine_bucket=settings.media_quarantine_bucket,
                public_bucket=settings.media_public_bucket,
                s3_client=objects,
                cognito_client=provider,
            )

    def operation(sub):
        with factory() as session:
            return session.scalar(
                select(models.AccountOperation)
                .join(models.AccountAuthority)
                .where(
                    models.AccountAuthority.issuer == issuer,
                    models.AccountAuthority.cognito_sub == sub,
                )
                .where(models.AccountOperation.kind == "delete")
            )

    def reconcile(*, now=None, batch_size=20, max_objects=1000):
        return account_deletion.reconcile_account_deletions(
            factory,
            settings=settings,
            s3_client=objects,
            cognito_client=provider,
            now=now or datetime(2099, 1, 1, tzinfo=UTC),
            batch_size=batch_size,
            max_objects=max_objects,
        )

    try:
        yield SimpleNamespace(
            engine=engine,
            factory=factory,
            settings=settings,
            issuer=issuer,
            seed=seed,
            delete=delete,
            operation=operation,
            reconcile=reconcile,
            objects=objects,
            provider=provider,
            calls=calls,
            models=models,
        )
    finally:
        get_settings.cache_clear()
        get_cognito_client.cache_clear()
        if _get_session_factory.cache_info().currsize:
            _get_session_factory().kw["bind"].dispose()
        _get_session_factory.cache_clear()
        try:
            Base.metadata.drop_all(engine)
        finally:
            engine.dispose()
