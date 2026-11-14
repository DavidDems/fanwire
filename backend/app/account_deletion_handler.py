"""Scheduled bounded scan; accepted work progresses even after flag rollback."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.account_deletion import get_cognito_client, get_s3_client, reconcile_account_deletions
from app.db import make_engine, make_session_factory
from app.dependencies import get_settings


def handler(event: dict[str, Any], context: Any) -> dict[str, int]:
    if context.get_remaining_time_in_millis() < 10000:
        return {"examined": 0, "completed": 0, "retrying": 0}
    settings = get_settings()
    engine = make_engine(settings.database_url)
    try:
        summary = reconcile_account_deletions(make_session_factory(engine), settings=settings,
            s3_client=get_s3_client(), cognito_client=get_cognito_client(), now=datetime.now(UTC),
            batch_size=10, max_objects=1000,
            remaining_time_ms=context.get_remaining_time_in_millis)
        if summary["retrying"]:
            raise RuntimeError("Account deletion work requires retry")
        return summary
    finally:
        engine.dispose()
