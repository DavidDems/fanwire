"""Scheduled entry point owns a session factory and performs bounded real work."""

import importlib
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest


def test_handler_uses_shared_reconciler_without_a_browser_or_subject(lifecycle_case, monkeypatch):
    from app import account_deletion

    handler = importlib.import_module("app.account_deletion_handler")
    case = lifecycle_case
    owner = case.seed()
    case.provider.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    case.provider.fail = False
    monkeypatch.setattr(handler, "get_settings", lambda: case.settings)
    monkeypatch.setattr(handler, "get_s3_client", lambda: case.objects)
    monkeypatch.setattr(handler, "get_cognito_client", lambda: case.provider)
    from app.dependencies import _get_session_factory

    _get_session_factory.cache_clear()
    actual = account_deletion.reconcile_account_deletions
    calls = []

    def bounded(factory, **kwargs):
        calls.append(kwargs)
        assert str(factory.kw["bind"].url) == str(case.engine.url)
        assert 0 < kwargs["batch_size"] <= 100
        assert 0 < kwargs["max_objects"] <= 1000
        return actual(factory, **{**kwargs, "now": datetime(2099, 1, 1, tzinfo=UTC)})

    monkeypatch.setattr(handler, "reconcile_account_deletions", bounded)
    result = handler.handler(
        {"source": "aws.events"}, SimpleNamespace(get_remaining_time_in_millis=lambda: 60000)
    )
    assert calls and case.operation(owner.sub).status == "completed"
    assert owner.sub not in repr(result)
    _get_session_factory.cache_clear()


def test_dormant_handler_does_not_run_destructive_work(lifecycle_case, monkeypatch):
    handler = importlib.import_module("app.account_deletion_handler")
    settings = lifecycle_case.settings.model_copy(update={"account_lifecycle_enabled": False})
    monkeypatch.setattr(handler, "get_settings", lambda: settings)
    monkeypatch.setattr(handler, "get_s3_client", lambda: lifecycle_case.objects)
    monkeypatch.setattr(handler, "get_cognito_client", lambda: lifecycle_case.provider)
    from app.dependencies import _get_session_factory

    _get_session_factory.cache_clear()
    handler.handler(
        {"source": "aws.events"}, SimpleNamespace(get_remaining_time_in_millis=lambda: 60000)
    )
    assert lifecycle_case.calls == []
    _get_session_factory.cache_clear()


def test_handler_surfaces_redacted_failure_after_processing_other_work(lifecycle_case, monkeypatch):
    handler = importlib.import_module("app.account_deletion_handler")
    monkeypatch.setattr(handler, "get_settings", lambda: lifecycle_case.settings)
    monkeypatch.setattr(handler, "get_s3_client", lambda: lifecycle_case.objects)
    monkeypatch.setattr(handler, "get_cognito_client", lambda: lifecycle_case.provider)
    monkeypatch.setattr(
        handler,
        "reconcile_account_deletions",
        lambda *_args, **_kwargs: {
            "examined": 2,
            "completed": 1,
            "retrying": 1,
        },
    )
    with pytest.raises(RuntimeError) as error:
        handler.handler(
            {"source": "aws.events"}, SimpleNamespace(get_remaining_time_in_millis=lambda: 60000)
        )
    assert "private" not in str(error.value)
    assert "lifecycle-sub" not in str(error.value)


def test_flag_rollback_does_not_strand_previously_accepted_work(lifecycle_case, monkeypatch):
    from app import account_deletion

    handler = importlib.import_module("app.account_deletion_handler")
    case = lifecycle_case
    owner = case.seed()
    case.provider.fail = True
    with pytest.raises(RuntimeError):
        case.delete(owner.sub)
    case.provider.fail = False
    disabled = case.settings.model_copy(update={"account_lifecycle_enabled": False})
    monkeypatch.setattr(handler, "get_settings", lambda: disabled)
    monkeypatch.setattr(handler, "get_s3_client", lambda: case.objects)
    monkeypatch.setattr(handler, "get_cognito_client", lambda: case.provider)
    reconcile = account_deletion.reconcile_account_deletions

    def next_scheduled_scan(factory, **kwargs):
        return reconcile(factory, **{**kwargs, "now": datetime(2099, 1, 1, tzinfo=UTC)})

    monkeypatch.setattr(handler, "reconcile_account_deletions", next_scheduled_scan)
    from app.dependencies import _get_session_factory

    _get_session_factory.cache_clear()
    handler.handler(
        {"source": "aws.events"}, SimpleNamespace(get_remaining_time_in_millis=lambda: 60000)
    )
    assert case.operation(owner.sub).status == "completed"
    _get_session_factory.cache_clear()


def test_handler_does_not_start_new_external_work_at_runtime_deadline(lifecycle_case, monkeypatch):
    handler = importlib.import_module("app.account_deletion_handler")
    monkeypatch.setattr(handler, "get_settings", lambda: lifecycle_case.settings)
    monkeypatch.setattr(handler, "get_s3_client", lambda: lifecycle_case.objects)
    monkeypatch.setattr(handler, "get_cognito_client", lambda: lifecycle_case.provider)
    calls = []
    monkeypatch.setattr(
        handler, "reconcile_account_deletions", lambda *_args, **_kwargs: calls.append(True)
    )
    handler.handler(
        {"source": "aws.events"}, SimpleNamespace(get_remaining_time_in_millis=lambda: 1)
    )
    assert calls == []



def test_handler_deletion_clients_bound_connect_read_and_total_attempts(lifecycle_case, monkeypatch):
    """Inspect SDK Config at the factory boundary; no AWS calls are made."""
    import boto3

    handler = importlib.import_module("app.account_deletion_handler")
    from app.media.dependencies import get_s3_client
    from app.users.dependencies import get_cognito_client

    get_s3_client.cache_clear()
    get_cognito_client.cache_clear()
    captured = {}

    def client(service, **kwargs):
        captured[service] = kwargs.get("config")
        return lifecycle_case.objects if service == "s3" else lifecycle_case.provider

    monkeypatch.setattr(boto3, "client", client)
    monkeypatch.setattr(handler, "get_settings", lambda: lifecycle_case.settings)
    monkeypatch.setattr(handler, "reconcile_account_deletions", lambda *_a, **_k: {
        "examined": 0, "completed": 0, "retrying": 0,
    })
    try:
        handler.handler({}, SimpleNamespace(get_remaining_time_in_millis=lambda: 120000))
        assert set(captured) == {"s3", "cognito-idp"}
        for config in captured.values():
            assert config is not None, "dedicated deletion clients need explicit SDK bounds"
            assert 0 < config.connect_timeout <= 5
            assert 0 < config.read_timeout <= 5
            attempts = config.retries.get("total_max_attempts")
            assert attempts is not None and 1 <= attempts <= 2
            assert attempts * (config.connect_timeout + config.read_timeout) < 30000 / 1000
    finally:
        get_s3_client.cache_clear()
        get_cognito_client.cache_clear()


def test_handler_passes_live_runtime_budget_to_shared_runner(lifecycle_case, monkeypatch):
    handler = importlib.import_module("app.account_deletion_handler")
    monkeypatch.setattr(handler, "get_settings", lambda: lifecycle_case.settings)
    monkeypatch.setattr(handler, "get_s3_client", lambda: lifecycle_case.objects)
    monkeypatch.setattr(handler, "get_cognito_client", lambda: lifecycle_case.provider)
    remaining = [60000]

    def reconcile(_factory, **kwargs):
        budget = kwargs.get("remaining_time_ms")
        assert callable(budget), "entry-time check cannot bound a multi-operation invocation"
        assert budget() == 60000
        remaining[0] = 9000
        assert budget() == 9000
        return {"examined": 0, "completed": 0, "retrying": 0}

    monkeypatch.setattr(handler, "reconcile_account_deletions", reconcile)
    handler.handler({}, SimpleNamespace(get_remaining_time_in_millis=lambda: remaining[0]))
