"""jev is switched off in the cheap automations, and says so.

The human's decision, 2026-10-16: over 9 shadow records jev answered `no` to
every question, its two most confident answers were wrong, and Haiku's
answers checked out each time (Prompts/04 Progress). jev stays wired, to be
used again once its use is better understood, but it is not asked.

What must hold:
  - the switch is `config.json` `automations.<name>.ask_jev`, one per
    automation, and both are off. Turning jev back on is one line.
  - `ask_jev.py --automation <name>` with the switch off makes no request and
    spends nothing, and writes an answer file that says "off", so a reader
    tells "switched off" from "asked, no answer".
  - the comments say `jev: off`, not `jev: no answer`.
  - both workflows name their automation when they run `ask_jev.py`.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from agentlib import coverage, drift

AI_ROOT = Path(__file__).resolve().parents[1]
REPO = AI_ROOT.parent
ASK_JEV = AI_ROOT / "bin" / "ask_jev.py"
WORKFLOWS = REPO / ".github" / "workflows"
KEY = "ts-test-NOT-A-REAL-KEY-7f3a"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def config() -> dict:
    return json.loads((AI_ROOT / "config.json").read_text(encoding="utf-8"))


class TestTheSwitch:
    @pytest.mark.parametrize("name", ["coverage", "spec_drift"])
    def test_jev_is_off_for_each_automation_that_asks_it(self, name):
        assert config()["automations"][name]["ask_jev"] is False


@pytest.fixture
def ask_jev():
    return load(ASK_JEV, "ask_jev_off_under_test")


@pytest.fixture
def files(tmp_path):
    state = tmp_path / "state.txt"
    state.write_text("a small state", encoding="utf-8")
    return {"state": state, "out": tmp_path / "out.json"}


def run(ask_jev, files, automation):
    return ask_jev.main(
        [
            "--questions",
            str(AI_ROOT / "questions" / "coverage.json"),
            "--state-file",
            str(files["state"]),
            "--out",
            str(files["out"]),
            "--automation",
            automation,
        ]
    )


class TestAskJevWhenOff:
    def test_it_makes_no_request_and_writes_an_answer_that_says_off(
        self, ask_jev, files, monkeypatch
    ):
        monkeypatch.setenv("TYPESAFE_API_KEY", KEY)

        def refuse(*a, **k):
            raise AssertionError("jev is off: no request may go out")

        monkeypatch.setattr(ask_jev.urllib.request, "urlopen", refuse)
        assert run(ask_jev, files, "coverage") == ask_jev.OK
        out = json.loads(files["out"].read_text(encoding="utf-8"))
        assert out["off"] is True
        assert out["answers"] == {} and out["cost_usd"] is None

    def test_an_automation_config_does_not_name_is_a_usage_error(self, ask_jev, files):
        assert run(ask_jev, files, "no_such_automation") == ask_jev.USAGE


class TestTheRenderSaysOff:
    def test_the_answer_file_reads_as_off(self, tmp_path):
        path = tmp_path / "jev.json"
        path.write_text(json.dumps({"answers": {}, "off": True, "cost_usd": None}), "utf-8")
        for script, name in (("spec_drift.py", "sd_off"), ("coverage_check.py", "cc_off")):
            jev = load(AI_ROOT / "bin" / script, name)._jev(path)
            assert jev["off"] is True and jev["choice"] is None, script

    def test_a_missing_answer_file_is_not_off(self, tmp_path):
        jev = load(AI_ROOT / "bin" / "spec_drift.py", "sd_missing")._jev(tmp_path / "none.json")
        assert not jev.get("off")

    @pytest.mark.parametrize(
        "line",
        [
            lambda jev: drift._shadow_line("claude-haiku-5-5", True, jev),
            lambda jev: coverage._shadow_line("claude-haiku-5-5", True, jev),
        ],
        ids=["spec_drift", "coverage"],
    )
    def test_the_shadow_line_says_off_not_no_answer(self, line):
        text = line({"off": True, "choice": None, "confidence": None, "cost_usd": None})
        assert "jev: off" in text and "no answer" not in text


class TestTheWorkflowsNameTheirAutomation:
    @pytest.mark.parametrize(
        "workflow,name",
        [("coverage-check.yml", "coverage"), ("spec-drift.yml", "spec_drift")],
    )
    def test_ask_jev_is_told_which_automation_asks(self, workflow, name):
        text = (WORKFLOWS / workflow).read_text(encoding="utf-8")
        (step,) = [s for s in text.split("\n      - ") if "ask_jev.py" in s]
        assert f"--automation {name}" in step
