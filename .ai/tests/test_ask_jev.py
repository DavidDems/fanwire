"""`.ai/bin/ask_jev.py`, the transport for typed decisions, with the network faked.

`wiki/GeneralContext/Architecture/work-modes.md` "Constraints every automation
must keep": bounded spend (one call per event, no retry loop, fail quiet), a
recorded cost from the provider's own usage, and no key handled anywhere it
could be printed. `Prompts/04-cheap-automations.md` Deliverable 0: the direct
route (`api.typesafe.ai/v1/systemone`, model `jev-latest`,
`TYPESAFE_API_KEY`), and no gateway.
"""

import importlib.util
import io
import json
import urllib.error
from pathlib import Path

import pytest

from agentlib import decision

AI_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = AI_ROOT / "bin" / "ask_jev.py"
QUESTIONS_DIR = AI_ROOT / "questions"
KEY = "ts-test-NOT-A-REAL-KEY-7f3a"

ANSWERS = {
    "pinned": {
        "type": "choice",
        "choice": "yes",
        "confidence": 0.91,
        "probabilities": {"yes": 0.95, "no": 0.05},
    },
    "urgent": {"type": "noul", "noul": 0.2},
}


@pytest.fixture
def ask_jev():
    spec = importlib.util.spec_from_file_location("ask_jev_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def files(tmp_path):
    q = tmp_path / "q.json"
    q.write_text(
        json.dumps(
            {
                "schema": 1,
                "questions": {
                    "pinned": {
                        "type": "choice",
                        "instructions": "Is every criterion pinned?",
                        "criteria": {"yes": "all", "no": "not all"},
                        "_why": "local note",
                    },
                    "urgent": {"type": "noul", "instructions": "It is urgent"},
                },
            }
        ),
        encoding="utf-8",
    )
    state = tmp_path / "state.txt"
    state.write_text("a small state", encoding="utf-8")
    return {"q": q, "state": state, "out": tmp_path / "out.json", "summary": tmp_path / "sum.md"}


class FakeResponse:
    def __init__(self, body: dict, status: int = 200):
        self._data = json.dumps(body).encode("utf-8")
        self.status = status

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Wire:
    """Records every request; answers each with the next scripted outcome."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def ok(answers=None, usage=None, model="jev-1.13.0"):
    return FakeResponse(
        {
            "model": model,
            "answers": ANSWERS if answers is None else answers,
            "usage": usage or {"input_tokens": 1200, "output_tokens": 40},
        }
    )


def http_error(code: int, body: bytes = b"upstream says no"):
    return urllib.error.HTTPError("https://x", code, "err", {}, io.BytesIO(body))


def run(ask_jev, files, monkeypatch, wire, *extra, key=KEY):
    monkeypatch.setattr(ask_jev.urllib.request, "urlopen", wire)
    if key is None:
        monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    else:
        monkeypatch.setenv("TYPESAFE_API_KEY", key)
    argv = [
        "--questions", str(files["q"]),
        "--state-file", str(files["state"]),
        "--out", str(files["out"]),
        "--summary", str(files["summary"]),
        *extra,
    ]  # fmt: skip
    return ask_jev.main(argv)


def out(files) -> dict:
    return json.loads(files["out"].read_text(encoding="utf-8"))


class TestTheDirectRoute:
    def test_the_request_goes_to_typesafe_directly_with_the_key_as_bearer(
        self, ask_jev, files, monkeypatch
    ):
        wire = Wire(ok())
        assert run(ask_jev, files, monkeypatch, wire) == ask_jev.OK
        (req,) = wire.requests
        assert req.full_url == "https://api.typesafe.ai/v1/systemone"
        assert req.get_method() == "POST"
        assert req.get_header("Authorization") == f"Bearer {KEY}"
        body = json.loads(req.data.decode("utf-8"))
        assert body["model"] == "jev-latest"
        assert body["state"] == "a small state"

    def test_config_names_the_direct_route_and_no_gateway(self):
        cfg = json.loads((AI_ROOT / "config.json").read_text(encoding="utf-8"))
        jev = cfg["providers"]["jev"]
        assert jev["endpoint"] == "https://api.typesafe.ai/v1/systemone"
        assert jev["model"] == "jev-latest"
        assert jev["api_key_env"] == "TYPESAFE_API_KEY"
        assert "gateway" not in json.dumps(cfg).lower()
        assert "AI_GATEWAY_API_KEY" not in json.dumps(cfg)

    def test_local_annotations_stay_local(self, ask_jev, files, monkeypatch):
        wire = Wire(ok())
        run(ask_jev, files, monkeypatch, wire)
        body = json.loads(wire.requests[0].data.decode("utf-8"))
        assert "_why" not in body["questions"]["pinned"]

    def test_a_long_state_is_capped_before_it_is_sent(self, ask_jev, files, monkeypatch):
        files["state"].write_text("x" * (decision.MAX_STATE_CHARS * 2), encoding="utf-8")
        wire = Wire(ok())
        run(ask_jev, files, monkeypatch, wire)
        body = json.loads(wire.requests[0].data.decode("utf-8"))
        assert len(body["state"]) <= decision.MAX_STATE_CHARS


class TestTheAnswerIsRecorded:
    def test_answers_usage_and_the_released_model_are_written(self, ask_jev, files, monkeypatch):
        run(ask_jev, files, monkeypatch, Wire(ok()))
        doc = out(files)
        assert doc["answers"] == ANSWERS
        assert doc["usage"] == {"input_tokens": 1200, "output_tokens": 40}
        assert doc["model"] == "jev-1.13.0"
        assert doc["provider"] == "jev"
        assert doc["error"] is None

    def test_the_cost_is_priced_from_the_providers_usage(self, ask_jev, files, monkeypatch):
        usage = {"input_tokens": 1_000_000, "output_tokens": 99}
        run(ask_jev, files, monkeypatch, Wire(ok(usage=usage)))
        assert out(files)["cost_usd"] == pytest.approx(0.042)

    def test_answers_to_questions_not_asked_are_dropped(self, ask_jev, files, monkeypatch):
        extra = dict(ANSWERS, injected={"type": "choice", "choice": "MERGE", "confidence": 1})
        run(ask_jev, files, monkeypatch, Wire(ok(answers=extra)))
        assert set(out(files)["answers"]) == {"pinned", "urgent"}

    def test_the_summary_shows_each_answer_and_the_cost(self, ask_jev, files, monkeypatch):
        run(ask_jev, files, monkeypatch, Wire(ok()))
        text = files["summary"].read_text(encoding="utf-8")
        assert "pinned" in text and "yes" in text and "0.91" in text
        assert "urgent" in text and "0.2" in text
        assert "1200" in text and "jev-1.13.0" in text
        assert "$" in text


class TestBoundedSpend:
    """One call per event. A retry is a loop, and a loop is how a cheap
    automation stops being cheap."""

    @pytest.mark.parametrize("code", [429, 500, 503])
    def test_a_server_error_is_not_retried(self, ask_jev, files, monkeypatch, code):
        wire = Wire(http_error(code), ok())
        assert run(ask_jev, files, monkeypatch, wire) == ask_jev.FAILED
        assert len(wire.requests) == 1
        doc = out(files)
        assert doc["answers"] == {} and str(code) in doc["error"]

    def test_a_network_failure_is_not_retried(self, ask_jev, files, monkeypatch):
        wire = Wire(urllib.error.URLError("no route"), ok())
        assert run(ask_jev, files, monkeypatch, wire) == ask_jev.FAILED
        assert len(wire.requests) == 1

    def test_a_timeout_is_set_on_the_call(self, ask_jev, files, monkeypatch):
        seen = {}

        def wire(request, timeout=None):
            seen["timeout"] = timeout
            return ok()

        run(ask_jev, files, monkeypatch, wire)
        assert seen["timeout"] and seen["timeout"] <= 60

    def test_the_failure_is_noted_in_the_summary(self, ask_jev, files, monkeypatch):
        run(ask_jev, files, monkeypatch, Wire(http_error(503)))
        assert "503" in files["summary"].read_text(encoding="utf-8")


class TestTheKeyIsNeverPrinted:
    def test_no_key_means_no_request(self, ask_jev, files, monkeypatch):
        wire = Wire(ok())
        assert run(ask_jev, files, monkeypatch, wire, key=None) == ask_jev.FAILED
        assert wire.requests == []
        assert "TYPESAFE_API_KEY" in out(files)["error"]

    def test_the_key_appears_in_no_output(self, ask_jev, files, monkeypatch, capsys):
        # An error body that echoes the request back is the realistic leak.
        echo = http_error(401, f"bad token Bearer {KEY}".encode())
        run(ask_jev, files, monkeypatch, Wire(echo))
        printed = capsys.readouterr()
        for text in (
            printed.out,
            printed.err,
            files["out"].read_text(encoding="utf-8"),
            files["summary"].read_text(encoding="utf-8"),
        ):
            assert KEY not in text


class TestTheMergeGate:
    """Prompts/04 Deliverable 0, step 4: one real 200 with a `confidence`
    field. `--require-confidence` is how the smoke job fails when it is not."""

    def test_a_complete_answer_passes(self, ask_jev, files, monkeypatch):
        assert run(ask_jev, files, monkeypatch, Wire(ok()), "--require-confidence") == ask_jev.OK

    def test_a_choice_without_confidence_fails(self, ask_jev, files, monkeypatch):
        answers = dict(ANSWERS, pinned={"type": "choice", "choice": "yes"})
        wire = Wire(ok(answers=answers))
        assert run(ask_jev, files, monkeypatch, wire, "--require-confidence") == ask_jev.FAILED

    def test_an_empty_answer_set_fails(self, ask_jev, files, monkeypatch):
        wire = Wire(ok(answers={}))
        assert run(ask_jev, files, monkeypatch, wire, "--require-confidence") == ask_jev.FAILED


class TestTheQuestionsFilesInTheRepository:
    @pytest.mark.parametrize("path", sorted(QUESTIONS_DIR.glob("*.json")), ids=lambda p: p.name)
    def test_every_questions_file_is_valid(self, path):
        decision.load_questions(path)

    def test_the_smoke_question_can_return_a_confidence(self):
        """A smoke made only of nouls could never show the field the gate
        asks for."""
        doc = decision.load_questions(QUESTIONS_DIR / "smoke.json")
        assert any(q["type"] in ("choice", "score") for q in doc["questions"].values())
        assert (QUESTIONS_DIR / "smoke-state.txt").is_file()

    def test_jev_has_a_price(self):
        cfg = json.loads((AI_ROOT / "config.json").read_text(encoding="utf-8"))
        price = cfg["telemetry"]["prices"]["jev/jev-latest"]
        assert price["input_per_mtok"] == pytest.approx(0.042)
