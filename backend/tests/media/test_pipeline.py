"""Tests for the media/ upload pipeline (Template Method), per AGENTS.md TDD
workflow. Written before app/media/pipeline.py exists.

See wiki/CodeContext/Modules/0x04-media.md GoF pattern tie-in:
`validateType -> scanForMalware -> stripMetadata -> generateVariants ->
publish`, matching wiki/CodeContext/Modules/0x00-architecture.md
"Ingestion & processing pipelines" and app.events.ingestion's
AbstractEventIngestionPipeline shape.

Fixture images are generated programmatically with Pillow (never committed
as binary files) — keeps the repo text-only and tests fast/deterministic.
"""

from __future__ import annotations

from app.media.pipeline import FakeMalwareScanner


def test_fake_malware_scanner_returns_preset_boolean_verdict():
    clean_scanner = FakeMalwareScanner(True)
    infected_scanner = FakeMalwareScanner(False)

    assert clean_scanner.scan(bucket="b", key="k") is True
    assert infected_scanner.scan(bucket="b", key="k") is False


def test_fake_malware_scanner_supports_per_key_verdicts():
    scanner = FakeMalwareScanner({"clean.jpg": True, "infected.jpg": False})

    assert scanner.scan(bucket="b", key="clean.jpg") is True
    assert scanner.scan(bucket="b", key="infected.jpg") is False


def test_fake_malware_scanner_defaults_missing_key_to_clean_in_dict_mode():
    scanner = FakeMalwareScanner({"infected.jpg": False})

    assert scanner.scan(bucket="b", key="unlisted.jpg") is True
