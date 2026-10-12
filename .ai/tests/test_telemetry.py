"""Telemetry: append-only, immutable, and never LLM-generated."""

import json
from pathlib import Path

import pytest

from agentlib import telemetry as tm


def record(**over):
    r = {
        "task_id": "DEMO-001",
        "workflow_run_id": "1234567890",
        "role": "code_agent",
        "provider": "anthropic",
        "model": "claude-opus-5",
        "session_id": "sess-abc",
        "attempt": 2,
        "started_at": "2026-09-20T10:00:00Z",
        "ended_at": "2026-09-20T10:04:30Z",
        "input_tokens": 12000,
        "output_tokens": 3000,
        "result": "committed",
        "commit_sha": "deadbeef",
        "ci_run_id": "999",
    }
    r.update(over)
    return r


class TestRecord:
    def test_writes_one_file_per_invocation(self, tmp_path):
        p = tm.record(tmp_path, record())
        assert p.exists()
        assert p.parent.name == "DEMO-001"
        data = json.loads(p.read_text(encoding="utf-8"))
        assert data["role"] == "code_agent"

    def test_total_tokens_are_derived_not_trusted(self, tmp_path):
        p = tm.record(tmp_path, record(total_tokens=1))
        assert json.loads(p.read_text(encoding="utf-8"))["total_tokens"] == 15000

    def test_cost_is_computed_when_a_price_is_known(self, tmp_path):
        prices = {"anthropic/claude-opus-5": {"input_per_mtok": 15.0, "output_per_mtok": 75.0}}
        p = tm.record(tmp_path, record(), prices=prices)
        data = json.loads(p.read_text(encoding="utf-8"))
        assert data["estimated_cost_usd"] == pytest.approx(12000 / 1e6 * 15 + 3000 / 1e6 * 75)

    def test_cost_is_null_rather_than_guessed_for_an_unpriced_model(self, tmp_path):
        p = tm.record(tmp_path, record(model="some-new-model"), prices={})
        assert json.loads(p.read_text(encoding="utf-8"))["estimated_cost_usd"] is None

    def test_duration_is_derived(self, tmp_path):
        p = tm.record(tmp_path, record())
        assert json.loads(p.read_text(encoding="utf-8"))["duration_seconds"] == 270

    def test_a_missing_required_field_is_rejected(self, tmp_path):
        bad = record()
        del bad["role"]
        with pytest.raises(tm.TelemetryError, match="role"):
            tm.record(tmp_path, bad)

    def test_an_unknown_role_is_rejected(self, tmp_path):
        with pytest.raises(tm.TelemetryError, match="role"):
            tm.record(tmp_path, record(role="shadow_agent"))

    def test_history_is_immutable(self, tmp_path):
        p = tm.record(tmp_path, record())
        with pytest.raises(tm.TelemetryError, match="exists"):
            tm.record(tmp_path, record(), filename=p.name)


class TestAggregate:
    def test_rolls_up_per_task_and_per_role(self, tmp_path):
        tm.record(tmp_path, record(role="test_agent", input_tokens=1000, output_tokens=500))
        tm.record(tmp_path, record(role="code_agent", input_tokens=2000, output_tokens=1000))
        tm.record(
            tmp_path,
            record(task_id="OTHER-002", role="distiller", input_tokens=300, output_tokens=100),
        )
        summary = tm.aggregate(tmp_path)
        assert summary["totals"]["total_tokens"] == 4900
        assert summary["by_task"]["DEMO-001"]["total_tokens"] == 4500
        assert summary["by_role"]["distiller"]["total_tokens"] == 400
        assert summary["by_model"]["claude-opus-5"]["invocations"] == 3

    def test_counts_attempts_and_escalations(self, tmp_path):
        tm.record(tmp_path, record(attempt=1, result="committed"))
        tm.record(tmp_path, record(attempt=2, result="committed"))
        tm.record(tmp_path, record(role="manager", attempt=2, result="escalated"))
        summary = tm.aggregate(tmp_path)
        assert summary["by_task"]["DEMO-001"]["attempts"] == 2
        assert summary["totals"]["escalations"] == 1

    def test_an_empty_store_aggregates_to_zeroes_not_an_error(self, tmp_path):
        summary = tm.aggregate(tmp_path)
        assert summary["totals"]["total_tokens"] == 0
        assert summary["by_task"] == {}

    def test_a_corrupt_record_is_reported_not_silently_dropped(self, tmp_path):
        (tmp_path / "DEMO-001").mkdir()
        (tmp_path / "DEMO-001" / "broken.json").write_text("{not json", encoding="utf-8")
        summary = tm.aggregate(tmp_path)
        assert summary["unreadable"] == ["DEMO-001/broken.json"]


# --------------------------------------------------------------------------- D6

CONFIG = json.loads(
    (Path(__file__).resolve().parents[1] / "config.json").read_text(encoding="utf-8")
)
PRICES = CONFIG["telemetry"]["prices"]

# tests/fixtures/claude-cli-2.1.295-envelope.json, a real one-turn call.
REAL = {
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "input_tokens": 9,
    "output_tokens": 48,
    "cache_creation_input_tokens": 8596,
    "cache_read_input_tokens": 16654,
    "cache_creation_1h_input_tokens": 8596,
    "cache_creation_5m_input_tokens": 0,
}
REAL_COST = 0.0191064
OPUS_PRICES = {"anthropic/claude-opus-5": {"input_per_mtok": 15.0, "output_per_mtok": 75.0}}
OPUS_ESTIMATE = 12000 / 1e6 * 15 + 3000 / 1e6 * 75


def written(path):
    return json.loads(path.read_text(encoding="utf-8"))


class TestTheProviderCostIsAuthoritative:
    """handoff.md §10, D6: MEDIA-002 recorded USD $1.25 against a real $2.65."""

    def test_provider_cost_is_the_cost(self, tmp_path):
        data = written(tm.record(tmp_path, record(**REAL, provider_cost_usd=REAL_COST), PRICES))
        assert data["cost_usd"] == pytest.approx(REAL_COST)
        assert data["cost_source"] == "provider"
        assert data["provider_cost_usd"] == pytest.approx(REAL_COST)

    def test_without_a_provider_cost_the_estimate_is_used_and_said_so(self, tmp_path):
        data = written(tm.record(tmp_path, record(), OPUS_PRICES))
        assert data["cost_source"] == "estimate"
        assert data["provider_cost_usd"] is None
        assert data["cost_usd"] == pytest.approx(OPUS_ESTIMATE)

    def test_the_caller_cannot_assert_a_cost_or_its_source(self, tmp_path):
        rec = record(cost_usd=0.0001, cost_source="provider")
        data = written(tm.record(tmp_path, rec, OPUS_PRICES))
        assert data["cost_source"] == "estimate"
        assert data["cost_usd"] == pytest.approx(OPUS_ESTIMATE)

    @pytest.mark.parametrize("bad", ["2.65", -1.0, True, float("nan")])
    def test_a_provider_cost_that_is_not_a_number_is_ignored(self, tmp_path, bad):
        data = written(tm.record(tmp_path, record(provider_cost_usd=bad), {}))
        assert data["provider_cost_usd"] is None
        assert data["cost_source"] == "estimate"

    def test_an_unpriced_model_with_no_provider_cost_is_null(self, tmp_path):
        data = written(tm.record(tmp_path, record(model="some-new-model"), {}))
        assert data["cost_usd"] is None
        assert data["cost_source"] == "estimate"


class TestTheEstimatePricesCacheTokens:
    def test_the_estimate_reconciles_with_the_provider_on_a_real_envelope(self, tmp_path):
        # The config's own prices against the real call: cache reads at 0.1x
        # input and 1-hour cache writes at 2x reproduce the provider's figure.
        data = written(tm.record(tmp_path, record(**REAL), PRICES))
        assert data["cost_source"] == "estimate"
        assert data["estimated_cost_usd"] == pytest.approx(REAL_COST)

    def test_cache_tokens_count_toward_the_total(self, tmp_path):
        data = written(tm.record(tmp_path, record(**REAL), PRICES))
        assert data["total_tokens"] == 9 + 48 + 8596 + 16654

    def test_cache_tokens_with_no_cache_price_are_never_guessed(self, tmp_path):
        prices = {"anthropic/claude-haiku-4-5": {"input_per_mtok": 1.0, "output_per_mtok": 5.0}}
        assert written(tm.record(tmp_path, record(**REAL), prices))["estimated_cost_usd"] is None

    def test_a_cache_write_of_unknown_duration_is_never_guessed(self, tmp_path):
        rec = record(**REAL)
        del rec["cache_creation_1h_input_tokens"]
        del rec["cache_creation_5m_input_tokens"]
        assert written(tm.record(tmp_path, rec, PRICES))["estimated_cost_usd"] is None

    def test_every_model_a_role_uses_is_priced_including_its_cache(self):
        for role, cfg in CONFIG["roles"].items():
            price = PRICES.get(f"{cfg['provider']}/{cfg['model']}")
            assert price, role
            for field in (
                "input_per_mtok",
                "output_per_mtok",
                "cache_read_per_mtok",
                "cache_write_5m_per_mtok",
                "cache_write_1h_per_mtok",
            ):
                assert isinstance(price.get(field), (int, float)), (role, field)

    @pytest.mark.parametrize(
        ("model", "inp", "out"),
        [
            ("claude-opus-5", 5.0, 25.0),
            ("claude-sonnet-5", 2.0, 10.0),
            ("claude-haiku-4-5", 1.0, 5.0),
            ("claude-opus-5-5", 4.0, 20.0),
            ("claude-sonnet-5-5", 2.0, 10.0),
            ("claude-haiku-5-5", 0.10, 0.50),
        ],
    )
    def test_list_prices(self, model, inp, out):
        price = PRICES[f"anthropic/{model}"]
        assert price["input_per_mtok"] == pytest.approx(inp)
        assert price["output_per_mtok"] == pytest.approx(out)


class TestEnvelopeFieldsAreStored:
    def test_they_default_to_null(self, tmp_path):
        data = written(tm.record(tmp_path, record()))
        for field in (
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
            "thinking_tokens",
            "num_turns",
            "permission_denials",
            "is_error",
            "subtype",
        ):
            assert field in data and data[field] is None, field

    def test_they_are_kept(self, tmp_path):
        rec = record(
            num_turns=7,
            permission_denials=2,
            permission_denied_tools=["Bash"],
            is_error=False,
            subtype="success",
            thinking_tokens=42,
        )
        data = written(tm.record(tmp_path, rec))
        assert data["num_turns"] == 7
        assert data["permission_denials"] == 2
        assert data["permission_denied_tools"] == ["Bash"]
        assert data["is_error"] is False
        assert data["subtype"] == "success"
        assert data["thinking_tokens"] == 42


class TestAggregateReportsTheRealSpend:
    def test_provider_cost_is_summed_and_estimates_are_flagged(self, tmp_path):
        tm.record(tmp_path, record(role="test_agent", provider_cost_usd=2.0), {})
        est = tm.record(tmp_path, record(role="code_agent"), OPUS_PRICES)
        summary = tm.aggregate(tmp_path)
        assert summary["totals"]["cost_usd"] == pytest.approx(2.0 + OPUS_ESTIMATE)
        assert summary["totals"]["estimated_records"] == 1
        assert summary["by_role"]["test_agent"]["estimated_records"] == 0
        assert summary["estimated"] == [f"DEMO-001/{est.name}"]

    def test_a_record_from_before_d6_counts_as_an_estimate(self, tmp_path):
        (tmp_path / "MEDIA-002").mkdir()
        old = {**record(task_id="MEDIA-002"), "schema": 1, "estimated_cost_usd": 0.85}
        (tmp_path / "MEDIA-002" / "old.json").write_text(json.dumps(old), encoding="utf-8")
        summary = tm.aggregate(tmp_path)
        assert summary["totals"]["cost_usd"] == pytest.approx(0.85)
        assert summary["totals"]["estimated_records"] == 1
        assert summary["estimated"] == ["MEDIA-002/old.json"]

    def test_an_unpriced_record_is_counted(self, tmp_path):
        tm.record(tmp_path, record(model="some-new-model"), {})
        assert tm.aggregate(tmp_path)["totals"]["unpriced_records"] == 1

    def test_permission_denials_are_summed_and_listed(self, tmp_path):
        rec = record(permission_denials=3, permission_denied_tools=["Bash", "Bash"])
        p = tm.record(tmp_path, rec)
        tm.record(tmp_path, record(permission_denials=0, attempt=3))
        summary = tm.aggregate(tmp_path)
        assert summary["totals"]["permission_denials"] == 3
        assert summary["denials"] == [
            {"record": f"DEMO-001/{p.name}", "count": 3, "tools": ["Bash", "Bash"]}
        ]

    def test_cache_tokens_are_summed(self, tmp_path):
        tm.record(tmp_path, record(**REAL, provider_cost_usd=REAL_COST))
        totals = tm.aggregate(tmp_path)["totals"]
        assert totals["cache_read_input_tokens"] == 16654
        assert totals["cache_creation_input_tokens"] == 8596
