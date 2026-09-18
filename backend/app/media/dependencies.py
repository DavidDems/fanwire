"""FastAPI dependency wiring for media/ routes — an injectable S3 client.

Dependency Inversion (wiki/CodeContext/Standards/design-principles.md):
routes depend on get_s3_client, never on boto3.client("s3", ...) directly,
so route tests can override it entirely via
`app.dependency_overrides[get_s3_client]`, typically bound to a
moto-mocked client the same way backend/tests/media/test_pipeline.py's
s3_client fixture builds one.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import boto3  # type: ignore[import-untyped]  # no boto3 stubs/py.typed marker installed

from app.dependencies import get_settings


@lru_cache(maxsize=1)
def get_s3_client() -> Any:
    """Process-wide boto3 S3 client, built once from get_settings()'s
    region — never per-request, same "build once, cache, inject" shape as
    app.dependencies.get_session's underlying engine/sessionmaker."""
    settings = get_settings()
    return boto3.client("s3", region_name=settings.aws_default_region)
