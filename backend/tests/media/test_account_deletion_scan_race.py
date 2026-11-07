"""Account deletion and scan publication serialize on the same Media row.

Two actual Postgres transactions race through the public scan handler and
account-deletion service. Events choose the transaction order; PostgreSQL's
blocking graph proves waiting rather than inferring it from a scheduling delay.
Only image preparation and the external S3/Cognito clients are doubles; the
pipeline's public PUTs, row update, quarantine cleanup and commit remain real.
"""

from __future__ import annotations

import json
from datetime import date
from threading import Event, Lock, Thread
from time import monotonic
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.account_deletion import delete_account_data
from app.db import Base, make_engine, make_session_factory
from app.media import lambda_handler
from app.media.models import Media, MediaStatus
from app.media.pipeline import ImageUploadPipeline
from app.users.models import User

WAIT_SECONDS = 15
QUARANTINE = "race-quarantine"
PUBLIC = "race-public"
ORIGINAL = "uploads/race/original.jpg"


def _wait(signal: Event, description: str) -> None:
    assert signal.wait(WAIT_SECONDS), f"timed out waiting for {description}"


class _Worker:
    def __init__(self, operation):
        self.errors: list[BaseException] = []
        self.result = None
        self.done = Event()

        def run():
            try:
                self.result = operation()
            except BaseException as error:  # noqa: BLE001 -- surface all thread failures in the main test
                self.errors.append(error)
            finally:
                self.done.set()

        self.thread = Thread(target=run, daemon=True)
        self.thread.start()

    def finish(self) -> None:
        self.thread.join(WAIT_SECONDS)
        assert not self.thread.is_alive(), "race worker did not terminate"
        assert self.errors == [], f"race worker failed: {self.errors}"


class _Objects:
    def __init__(self, *, pause_deletion: bool):
        self.objects = {(QUARANTINE, ORIGINAL)}
        self.puts: list[tuple[str, str]] = []
        self.bulk_deletes: list[tuple[str, str]] = []
        self.lock = Lock()
        self.deletion_snapshot_reached_s3 = Event()
        self.release_deletion = Event()
        if not pause_deletion:
            self.release_deletion.set()

    def put_object(self, *, Bucket, Key, **_kwargs):
        with self.lock:
            self.objects.add((Bucket, Key))
            self.puts.append((Bucket, Key))
        return {}

    def delete_object(self, *, Bucket, Key):
        with self.lock:
            self.objects.discard((Bucket, Key))
        return {}

    def delete_objects(self, *, Bucket, Delete):
        self.deletion_snapshot_reached_s3.set()
        _wait(self.release_deletion, "release of account S3 deletion")
        with self.lock:
            for item in Delete["Objects"]:
                key = (Bucket, item["Key"])
                self.objects.discard(key)
                self.bulk_deletes.append(key)
        return {"Deleted": Delete["Objects"]}


class _Cognito:
    def __init__(self):
        self.deleted = Event()

    def admin_delete_user(self, *, UserPoolId, Username):
        assert UserPoolId == "race-pool"
        assert Username == "race-sub"
        self.deleted.set()
        return {}


@pytest.fixture()
def race(postgres_url, monkeypatch):
    engine = make_engine(postgres_url)
    factory = make_session_factory(engine)
    Base.metadata.create_all(engine)
    with factory() as session:
        owner = User(
            cognito_sub="race-sub",
            username="race_owner",
            date_of_birth=date(1990, 1, 1),
        )
        session.add(owner)
        session.flush()
        media = Media(
            uploader_id=owner.id,
            status=MediaStatus.UPLOADED,
            s3_key_quarantine=ORIGINAL,
        )
        session.add(media)
        session.flush()
        owner_id, media_id = owner.id, media.id
        session.commit()

    pipeline_entered, release_pipeline = Event(), Event()
    scan_connected, deletion_connected = Event(), Event()
    pids: dict[str, int] = {}

    class _PreparedImagePipeline(ImageUploadPipeline):
        def run(self):
            pipeline_entered.set()
            _wait(release_pipeline, "release of scan publication")
            super().run()

        def validate_type(self):
            self._media.mime_type = "image/jpeg"

        def scan_for_malware(self):
            pass

        def strip_metadata(self):
            pass

        def generate_variants(self):
            self._served_bytes = b"prepared public image"
            self._thumbnail_bytes = b"prepared thumbnail image"

    def scan_session():
        session = factory()
        pids["scan"] = session.execute(text("SELECT pg_backend_pid()")).scalar_one()
        scan_connected.set()
        return session

    monkeypatch.setattr(lambda_handler, "open_session", scan_session)
    monkeypatch.setattr(lambda_handler, "ImageUploadPipeline", _PreparedImagePipeline)
    monkeypatch.setattr(
        lambda_handler,
        "get_settings",
        lambda: SimpleNamespace(media_quarantine_bucket=QUARANTINE, media_public_bucket=PUBLIC),
    )
    workers: list[_Worker] = []
    object_stores: list[_Objects] = []

    def start_scan(objects):
        monkeypatch.setattr(lambda_handler, "get_s3_client", lambda: objects)
        event = {
            "Records": [{
                "messageId": "scan-race",
                "body": json.dumps({"detail": {
                    "s3ObjectDetails": {"objectKey": ORIGINAL},
                    "scanResultDetails": {"scanResultStatus": "NO_THREATS_FOUND"},
                }}),
            }],
        }
        worker = _Worker(lambda: lambda_handler.handler(event, None))
        workers.append(worker)
        return worker

    def start_deletion(objects, cognito):
        object_stores.append(objects)

        def remove():
            with factory() as session:
                pids["deletion"] = session.execute(text("SELECT pg_backend_pid()")).scalar_one()
                deletion_connected.set()
                delete_account_data(
                    session,
                    cognito_sub="race-sub",
                    s3_client=objects,
                    cognito_client=cognito,
                    user_pool_id="race-pool",
                    quarantine_bucket=QUARANTINE,
                    public_bucket=PUBLIC,
                )

        worker = _Worker(remove)
        workers.append(worker)
        return worker

    def blocked_before_progress(waiter, holder, progress):
        deadline = monotonic() + WAIT_SECONDS
        with engine.connect() as connection:
            while monotonic() < deadline:
                if progress.is_set():
                    return False
                blockers = connection.execute(
                    text("SELECT pg_blocking_pids(:pid)"), {"pid": pids[waiter]},
                ).scalar_one()
                if pids[holder] in blockers:
                    return True
                assert not any(worker.errors for worker in workers), "worker failed before lock observation"
        raise AssertionError("neither expected Postgres lock wait nor unlocked progress observed")

    yield SimpleNamespace(
        factory=factory, owner_id=owner_id, media_id=media_id,
        pipeline_entered=pipeline_entered, release_pipeline=release_pipeline,
        scan_connected=scan_connected, deletion_connected=deletion_connected,
        start_scan=start_scan, start_deletion=start_deletion,
        blocked_before_progress=blocked_before_progress,
    )
    release_pipeline.set()
    for objects in object_stores:
        objects.release_deletion.set()
    for worker in workers:
        worker.thread.join(WAIT_SECONDS)
    assert all(not worker.thread.is_alive() for worker in workers), "worker leaked beyond test"
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_scan_first_deletion_waits_for_publication_and_removes_both_new_keys(race):
    objects, cognito = _Objects(pause_deletion=False), _Cognito()
    scan = race.start_scan(objects)
    _wait(race.pipeline_entered, "scan to hold its selected media row")
    deletion = race.start_deletion(objects, cognito)
    _wait(race.deletion_connected, "account deletion connection")
    blocked = race.blocked_before_progress(
        "deletion", "scan", objects.deletion_snapshot_reached_s3,
    )
    if not blocked:
        # On the broken implementation, finish deletion while scan still
        # holds its stale row, making the late-publication orphan observable.
        _wait(deletion.done, "unlocked deletion to finish")
    race.release_pipeline.set()
    scan.finish()
    deletion.finish()

    public_keys = {
        (PUBLIC, f"media/{race.media_id}/public.jpg"),
        (PUBLIC, f"media/{race.media_id}/thumbnail.jpg"),
    }
    assert blocked, "deletion took its S3-key snapshot before scan committed its new keys"
    assert scan.result == {"batchItemFailures": []}
    assert cognito.deleted.is_set()
    assert set(objects.puts) == public_keys
    assert public_keys <= set(objects.bulk_deletes)
    assert objects.objects == set(), "successful deletion left uploaded image objects behind"
    with race.factory() as session:
        assert session.get(Media, race.media_id) is None
        assert session.get(User, race.owner_id) is None


def test_deletion_first_late_scan_waits_then_noops_without_public_puts(race):
    objects, cognito = _Objects(pause_deletion=True), _Cognito()
    deletion = race.start_deletion(objects, cognito)
    _wait(objects.deletion_snapshot_reached_s3, "deletion's media-key snapshot")
    scan = race.start_scan(objects)
    _wait(race.scan_connected, "scan connection")
    blocked = race.blocked_before_progress("scan", "deletion", race.pipeline_entered)
    objects.release_deletion.set()
    _wait(deletion.done, "deletion to commit and finish")
    race.release_pipeline.set()
    deletion.finish()
    scan.finish()

    assert blocked, "scan read the media row after deletion's snapshot without waiting"
    assert not race.pipeline_entered.is_set(), "late scan processed an account's deleted media"
    assert scan.result == {"batchItemFailures": []}
    assert cognito.deleted.is_set()
    assert objects.puts == [], "late scan recreated public objects after successful deletion"
    assert objects.objects == set()
    with race.factory() as session:
        assert session.get(Media, race.media_id) is None
        assert session.get(User, race.owner_id) is None
