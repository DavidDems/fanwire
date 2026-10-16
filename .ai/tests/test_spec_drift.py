"""The spec drift check: does a task spec name things the code no longer has?

`wiki/GeneralContext/Architecture/work-modes.md` "Cheap automation":
`MEDIA-002`'s spec named a `Quarantined` status that did not exist and linked
a deleted TODO; it was caught by hand (#122). `Prompts/04-cheap-automations.md`
automation 3: a `workflow_dispatch` the human runs before a unit, reading
`main`. The deterministic part (do the paths and links exist?) needs no
model. `claude-haiku-5-5` is asked only for names inside prose, and a name it
says is missing is kept only if the code really does not have it. The result
goes to the job summary, and to a comment on the task's open PR if there is
one.

`jev` is asked "does the spec still match the code?" in shadow, as one
two-option `choice`, and both answers are recorded in a hidden
`<!-- fanwire-shadow {...} -->` record (`Prompts/04` "Decided by the human").

Validated against `MEDIA-002`'s spec as it was before #122
(`fixtures/media002-pre122/`, from `git show 2f3cfed^`): the dead link is
found without a model, and `Quarantined` survives the check against the code
while a status the code has is dropped.

The API is faked throughout. The first live call is the human's go.
"""

import importlib.util
import io
import json
import shutil
import urllib.error
from pathlib import Path

import pytest

from agentlib import decision, drift, promptbuild, shadow

AI_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = AI_ROOT / "bin" / "spec_drift.py"
QUESTIONS = AI_ROOT / "questions" / "drift.json"
PRE122 = Path(__file__).resolve().parent / "fixtures" / "media002-pre122"
KEY = "sk-ant-test-NOT-A-REAL-KEY-91c2"
TASK = "MEDIA-002"

STATE_PY = '''\
"""Media status chain: Uploaded -> Scanning -> Processed | Rejected."""

UPLOADED = "Uploaded"
SCANNING = "Scanning"
PROCESSED = "Processed"
REJECTED = "Rejected"


def mark_processed(media):
    media.status = PROCESSED
'''

USAGE = {
    "input_tokens": 6000,
    "output_tokens": 150,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
}

ANSWER = {
    "names": [
        {
            "name": "Quarantined",
            "where": "acceptance criterion 1",
            "why": "Media.status has no Quarantined; the chain starts at Uploaded.",
            "assumed_to_exist": True,
        },
        {
            "name": "Uploaded",
            "where": "objective",
            "why": "a wrong claim, dropped",
            "assumed_to_exist": True,
        },
        # What Haiku did on #162 and #161: listed a name and said, in its own
        # why, that the unit is asked to create it.
        {
            "name": "Tabs",
            "where": "acceptance criterion 11",
            "why": "No Tabs component exists yet; the unit is asked to create it.",
            "assumed_to_exist": False,
        },
    ]
}


def config() -> dict:
    return json.loads((AI_ROOT / "config.json").read_text(encoding="utf-8"))


def write(root: Path, path: str, text: str = "x\n") -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


@pytest.fixture
def repo(tmp_path) -> Path:
    """A repository as it stood when MEDIA-002's spec named `Quarantined`:
    the status chain in `state.py`, a test file that mentions `Quarantined`
    in a comment (a test is not the code), and no `TODO/02-deployment-
    requirements.md`."""
    root = tmp_path / "repo"
    task_dir = root / ".ai" / "tasks" / TASK
    task_dir.mkdir(parents=True)
    shutil.copy(PRE122 / "task.json", task_dir / "task.json")
    shutil.copy(PRE122 / "brief.md", task_dir / "brief.md")
    write(root, "wiki/GeneralContext/Architecture/human-decisions.md")
    write(root, "wiki/CodeContext/Modules/0x04-media.md")
    write(root, "wiki/CodeContext/Standards/security.md")
    write(root, "wiki/CodeContext/Standards/design-principles.md")
    write(root, "backend/app/media/state.py", STATE_PY)
    write(root, "backend/app/media/lambda_handler.py", "from .state import mark_processed\n")
    write(root, "backend/alembic/env.py")
    write(root, "backend/scripts/seed_dev.py", '"""Dev fixture data."""\n')
    write(
        root,
        "backend/tests/media/test_state.py",
        "# There is no `Quarantined` status.\ndef test_x():\n    assert True\n",
    )
    return root


def spec_and_brief(root: Path) -> tuple[dict, str]:
    task_dir = root / ".ai" / "tasks" / TASK
    spec = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
    return spec, (task_dir / "brief.md").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- the deterministic part


class TestPathsAndLinksNeedNoModel:
    def test_the_deleted_todo_link_is_found(self, repo):
        spec, brief = spec_and_brief(repo)
        findings = drift.check_paths(TASK, spec, brief, repo)
        assert [(f["kind"], f["name"]) for f in findings] == [
            ("link", "TODO/02-deployment-requirements.md")
        ]

    def test_a_missing_required_context_file_is_found(self, repo):
        (repo / "wiki/CodeContext/Standards/security.md").unlink()
        spec, brief = spec_and_brief(repo)
        kinds = {(f["kind"], f["name"]) for f in drift.check_paths(TASK, spec, brief, repo)}
        assert ("required_context", "wiki/CodeContext/Standards/security.md") in kinds

    def test_a_glob_whose_directory_is_gone_is_found(self, repo):
        shutil.rmtree(repo / "backend/alembic")
        spec, brief = spec_and_brief(repo)
        kinds = {(f["kind"], f["name"]) for f in drift.check_paths(TASK, spec, brief, repo)}
        assert ("forbidden_paths", "backend/alembic/**") in kinds

    def test_a_file_the_unit_will_create_is_not_drift(self, repo):
        """`backend/scripts/dev_process_media.py` is in `allowed_paths` and
        does not exist yet: that is the unit's job, not drift."""
        spec, brief = spec_and_brief(repo)
        names = {f["name"] for f in drift.check_paths(TASK, spec, brief, repo)}
        assert "backend/scripts/dev_process_media.py" not in names
        assert "backend/tests/media/test_dev_process_media.py" not in names

    def test_a_backticked_repository_path_that_is_gone_is_found(self, repo):
        spec, brief = spec_and_brief(repo)
        brief += "\nSee `backend/app/media/verdict.py` for the handler.\n"
        kinds = {(f["kind"], f["name"]) for f in drift.check_paths(TASK, spec, brief, repo)}
        assert ("path", "backend/app/media/verdict.py") in kinds

    def test_a_shorthand_that_is_not_a_repository_path_is_left_alone(self, repo):
        """The brief says `media/` meaning the module, not a top-level
        directory; only a token whose first segment is a top-level entry of
        the repository is checked as a path."""
        spec, brief = spec_and_brief(repo)
        names = {f["name"] for f in drift.check_paths(TASK, spec, brief, repo)}
        assert "media/" not in names

    def test_external_links_and_anchors_are_not_checked(self, repo):
        spec, brief = spec_and_brief(repo)
        brief += "\n[docs](https://example.com/x) and [below](#the-safety-requirement)\n"
        names = {f["name"] for f in drift.check_paths(TASK, spec, brief, repo)}
        assert not any("example.com" in n or n.startswith("#") for n in names)

    def test_a_link_cannot_reach_outside_the_repository(self, repo, tmp_path):
        write(tmp_path, "outside.md")
        spec, brief = spec_and_brief(repo)
        brief += "\n[out](../../../../outside.md)\n"
        findings = drift.check_paths(TASK, spec, brief, repo)
        assert any(f["kind"] == "link" and "outside.md" in f["name"] for f in findings)


class TestNamesAreCheckedAgainstTheCode:
    def test_a_name_in_the_code_is_found(self, repo):
        assert drift.name_in_code("Uploaded", repo)
        assert drift.name_in_code("mark_processed", repo)

    def test_a_name_only_a_test_mentions_is_not_in_the_code(self, repo):
        assert not drift.name_in_code("Quarantined", repo)

    def test_a_name_must_match_as_a_whole_word(self, repo):
        assert not drift.name_in_code("Upload", repo)

    def test_a_dotted_name_needs_every_part(self, repo):
        assert drift.name_in_code("media.status", repo)
        assert not drift.name_in_code("media.quarantine_state", repo)


class TestTheModelIsAskedOnlyAboutProse:
    def body(self, repo, findings=None):
        spec, brief = spec_and_brief(repo)
        context, _ = drift.context_files(spec, brief, repo)
        return drift.request_body(
            spec,
            brief,
            context,
            findings or [],
            model="claude-haiku-5-5",
            max_tokens=drift.MAX_TOKENS,
            system="SYSTEM RULES",
        )

    def test_the_request_is_bounded(self, repo):
        body = self.body(repo)
        assert body["model"] == "claude-haiku-5-5"
        assert 0 < body["max_tokens"] <= 4000
        assert "tools" not in body
        # Haiku 5.5 thinks by default, and the thinking ate all of max_tokens
        # on #155 (stop_reason=max_tokens; content=[thinking]).
        assert body["thinking"] == {"type": "disabled"}
        assert "output_config" not in body

    def test_the_spec_and_the_code_it_touches_are_fenced_as_data(self, repo):
        user = self.body(repo)["messages"][0]["content"]
        assert "Quarantined" in user  # the spec
        assert "SCANNING" in user  # backend/app/media/state.py, a forbidden_paths file
        assert "There is no `Quarantined` status" not in user  # tests are not the code
        assert user.count(promptbuild.FENCE) % 2 == 0
        assert "Running the script" not in user.split(promptbuild.FENCE, 1)[0]

    def test_the_context_is_capped_whole_files(self, repo):
        spec, brief = spec_and_brief(repo)
        context, omitted = drift.context_files(spec, brief, repo, max_chars=50)
        assert all(len(text) <= 50 for text in context.values())
        assert "backend/app/media/state.py" in omitted

    def test_the_default_cap_keeps_the_input_far_below_100k_tokens(self):
        assert drift.MAX_CONTEXT_CHARS <= 240_000

    def test_the_system_prompt_is_a_committed_file(self):
        text = (AI_ROOT / "prompts" / "spec-drift.md").read_text(encoding="utf-8")
        assert "data" in text.lower() and "json" in text.lower()
        assert '"assumed_to_exist": true' in text


def text_body(answer, usage=None) -> dict:
    text = answer if isinstance(answer, str) else json.dumps(answer)
    return {
        "model": "claude-haiku-5-5",
        "stop_reason": "end_turn",
        "content": [{"type": "text", "text": text}],
        "usage": usage or USAGE,
    }


class TestReadingTheAnswer:
    def test_quarantined_is_kept_and_a_name_the_code_has_is_dropped(self, repo):
        names, dropped, created = drift.read_answer(text_body(ANSWER), repo)
        assert [n["name"] for n in names] == ["Quarantined"]
        assert names[0]["where"] == "acceptance criterion 1"
        assert dropped == 1
        assert created == 1

    @pytest.mark.parametrize("flag", [False, None, "true", 1, "missing"])
    def test_a_name_not_claimed_to_exist_is_left_out_and_counted(self, repo, flag):
        """Only `"assumed_to_exist": true` counts: a name the unit is asked to
        create is the unit's work, not drift, whatever else the entry says."""
        entry = {"name": "Quarantined", "where": "objective", "why": "x"}
        if flag != "missing":
            entry["assumed_to_exist"] = flag
        names, dropped, created = drift.read_answer(text_body({"names": [entry]}), repo)
        assert names == [] and dropped == 0 and created == 1

    def test_a_fenced_answer_is_read(self, repo):
        names, _, _ = drift.read_answer(text_body("```json\n" + json.dumps(ANSWER) + "\n```"), repo)
        assert [n["name"] for n in names] == ["Quarantined"]

    @pytest.mark.parametrize(
        "body",
        [
            {},
            {"content": [{"type": "text", "text": "no json"}]},
            {"content": [{"type": "text", "text": '{"names": "x"}'}]},
        ],
    )
    def test_no_usable_answer_is_none(self, repo, body):
        assert drift.read_answer(body, repo) is None

    def test_malformed_entries_are_skipped(self, repo):
        answer = {"names": [{"name": 3}, "x", {"name": ""}, *ANSWER["names"]]}
        names, _, _ = drift.read_answer(text_body(answer), repo)
        assert [n["name"] for n in names] == ["Quarantined"]


class TestTheShadowQuestion:
    def test_the_questions_file_is_one_yes_no_choice(self):
        doc = decision.load_questions(QUESTIONS)
        assert list(doc["questions"]) == [drift.JEV_QUESTION]
        question = doc["questions"][drift.JEV_QUESTION]
        assert question["type"] == "choice"
        assert set(question["criteria"]) == {"yes", "no"}

    def test_jevs_state_fits(self, repo):
        spec, brief = spec_and_brief(repo)
        state = drift.jev_state(spec, brief, {"a.py": "x" * 500_000}, [])
        assert "Quarantined" in state and len(state) <= decision.MAX_STATE_CHARS


class TestTheReport:
    def render(self, repo, **kw):
        spec, brief = spec_and_brief(repo)
        findings = drift.check_paths(TASK, spec, brief, repo)
        names, dropped, created = drift.read_answer(text_body(ANSWER), repo)
        args = {
            "dropped": dropped,
            "created": created,
            "omitted": [],
            "usage": USAGE,
            "cost": 0.000675,
            "model": "claude-haiku-5-5",
            "jev": None,
            "record": {"automation": "spec_drift", "task": TASK},
            "run_url": "https://github.com/DavidDems/fanwire/actions/runs/1",
            **kw,
        }
        return drift.render(TASK, findings, names, **args)

    def test_it_starts_with_its_marker(self, repo):
        text = self.render(repo)
        assert text.startswith(drift.MARKER + "\n")
        assert drift.MARKER not in ("<!-- fanwire-ci-summary -->", "<!-- fanwire-coverage -->")

    def test_it_names_the_link_and_the_status(self, repo):
        text = self.render(repo)
        assert "MEDIA-002" in text
        assert "02-deployment-requirements.md" in text
        assert "Quarantined" in text and "acceptance criterion 1" in text
        assert "$0.000675" in text and "claude-haiku-5-5" in text

    def test_a_name_the_unit_creates_is_counted_not_listed(self, repo):
        text = self.render(repo)
        assert "Tabs" not in text
        assert "1 name(s) the model said the unit is to create" in text

    def test_a_clean_spec_says_so(self, repo):
        text = drift.render(
            TASK, [], [], dropped=0, omitted=[], usage=USAGE, cost=0.0, model="m", jev=None,
            record={}, run_url="https://github.com/x/y/actions/runs/1",
        )  # fmt: skip
        assert "no drift found" in text.lower()

    def test_jev_is_shown_and_the_record_is_hidden_at_the_end(self, repo):
        jev = {"choice": "no", "confidence": 0.77, "cost_usd": 0.0000501, "model": "jev-1.13.0"}
        text = self.render(repo, jev=jev)
        assert "0.77" in text and "$0.0000501" in text
        assert shadow.decode(text) == [{"automation": "spec_drift", "task": TASK}]

    def test_model_text_stays_text(self, repo):
        hostile = {"name": "Quarantined", "where": "@someone <!-- x -->", "why": "[x](https://evil.example) <img src=x>"}  # fmt: skip
        text = drift.render(
            TASK, [], [hostile], dropped=0, omitted=[], usage=USAGE, cost=0.0, model="m",
            jev=None, record={}, run_url="https://github.com/x/y/actions/runs/1",
        )  # fmt: skip
        visible = text.split(shadow.PREFIX, 1)[0]
        assert visible.count("<!--") == 1
        assert (
            "@someone" not in visible and "](https://evil" not in visible and "<img" not in visible
        )


# --------------------------------------------------------------------------- the script


@pytest.fixture
def check():
    spec = importlib.util.spec_from_file_location("spec_drift_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, body: dict):
        self._data = json.dumps(body).encode("utf-8")

    def read(self):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Wire:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append((request, timeout))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def answered(answer=None):
    return FakeResponse(text_body(answer if answer is not None else ANSWER))


def http_error(code, body=b"upstream says no"):
    return urllib.error.HTTPError("https://x", code, "err", {}, io.BytesIO(body))


@pytest.fixture
def out(tmp_path):
    return {
        "work": tmp_path / "work",
        "summary": tmp_path / "summary.md",
        "comment": tmp_path / "comment.md",
    }


def ask(check, repo, out, monkeypatch, wire, *, key=KEY, task=TASK):
    monkeypatch.setattr(check.urllib.request, "urlopen", wire)
    if key is None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    else:
        monkeypatch.setenv("ANTHROPIC_API_KEY", key)
    return check.main([
        "ask",
        "--task-id", task,
        "--repo-root", str(repo),
        "--work", str(out["work"]),
        "--summary", str(out["summary"]),
    ])  # fmt: skip


def render(check, out, pr=None):
    argv = [
        "render",
        "--work", str(out["work"]),
        "--run-url", "https://github.com/DavidDems/fanwire/actions/runs/1",
        "--comment-out", str(out["comment"]),
        "--summary", str(out["summary"]),
    ]  # fmt: skip
    if pr is not None:
        argv += ["--pr-number", pr]
    return check.main(argv)


def jev_answers(choice="no", confidence=0.81):
    return {
        "answers": {drift.JEV_QUESTION: {"type": "choice", "choice": choice, "confidence": confidence}},
        "usage": {"input_tokens": 2100, "output_tokens": 0},
        "provider": "jev",
        "model": "jev-1.13.0",
        "error": None,
        "cost_usd": 0.0000882,
    }  # fmt: skip


class TestTheOneCall:
    def test_one_request_then_a_result_and_jevs_state(self, check, repo, out, monkeypatch):
        wire = Wire(answered())
        assert ask(check, repo, out, monkeypatch, wire) == check.OK
        ((req, timeout),) = wire.requests
        assert req.full_url == "https://api.anthropic.com/v1/messages"
        assert req.get_header("X-api-key") == KEY
        assert timeout and timeout <= 60
        assert json.loads(req.data.decode("utf-8"))["model"] == "claude-haiku-5-5"
        result = json.loads((out["work"] / "drift.json").read_text(encoding="utf-8"))
        assert result["task_id"] == TASK
        assert [f["name"] for f in result["findings"]] == ["TODO/02-deployment-requirements.md"]
        assert [n["name"] for n in result["names"]] == ["Quarantined"]
        assert result["dropped"] == 1
        assert result["created"] == 1
        assert result["cost_usd"] == pytest.approx(6000 * 0.1 / 1e6 + 150 * 0.5 / 1e6)
        assert "Quarantined" in (out["work"] / "jev-state.txt").read_text(encoding="utf-8")

    def test_config_names_the_model_and_the_caps(self):
        auto = config()["automations"]["spec_drift"]
        assert auto["provider"] == "anthropic"
        assert auto["model"] == "claude-haiku-5-5"
        assert 0 < auto["max_tokens"] <= drift.MAX_TOKENS
        assert auto["max_context_chars"] <= drift.MAX_CONTEXT_CHARS


class TestFailingQuietButKeepingTheFreePart:
    @pytest.mark.parametrize("code", [429, 500, 529])
    def test_a_failed_call_is_not_retried_and_the_path_findings_still_report(
        self, check, repo, out, monkeypatch, code
    ):
        """The paths and links were checked for free before the call; a
        failed call must not throw that away. The result says the model gave
        no answer, and jev is not asked."""
        wire = Wire(http_error(code), answered())
        assert ask(check, repo, out, monkeypatch, wire) == check.FAILED
        assert len(wire.requests) == 1
        result = json.loads((out["work"] / "drift.json").read_text(encoding="utf-8"))
        assert [f["name"] for f in result["findings"]] == ["TODO/02-deployment-requirements.md"]
        assert result["model"] is None and result["names"] == []
        assert result["error"]
        assert not (out["work"] / "jev-state.txt").exists()
        assert str(code) in out["summary"].read_text(encoding="utf-8")

    def test_an_unusable_answer_records_why_and_what_it_cost(
        self, check, repo, out, monkeypatch, capsys
    ):
        body = {"model": "claude-haiku-5-5", "stop_reason": "max_tokens",
                "content": [{"type": "text", "text": '{"names": ['}], "usage": USAGE}  # fmt: skip
        assert ask(check, repo, out, monkeypatch, Wire(FakeResponse(body))) == check.FAILED
        summary = out["summary"].read_text(encoding="utf-8")
        assert "max_tokens" in summary and "6000" in summary and "$0.000" in summary
        printed = capsys.readouterr()
        assert "max_tokens" in printed.out + printed.err

    def test_a_result_from_before_is_never_reused(self, check, repo, out, monkeypatch):
        out["work"].mkdir(parents=True)
        (out["work"] / "jev-state.txt").write_text("old", encoding="utf-8")
        ask(check, repo, out, monkeypatch, Wire(http_error(500)))
        assert not (out["work"] / "jev-state.txt").exists()

    def test_no_key_means_no_request(self, check, repo, out, monkeypatch):
        wire = Wire(answered())
        assert ask(check, repo, out, monkeypatch, wire, key=None) == check.FAILED
        assert wire.requests == []

    @pytest.mark.parametrize("task", ["../x", "lower-001", "MEDIA-002\nX", ""])
    def test_a_task_id_that_is_not_one_is_refused_before_anything(
        self, check, repo, out, monkeypatch, task
    ):
        wire = Wire(answered())
        assert ask(check, repo, out, monkeypatch, wire, task=task) == check.USAGE
        assert wire.requests == [] and not (out["work"] / "drift.json").exists()

    def test_a_task_with_no_spec_is_a_usage_error(self, check, repo, out, monkeypatch):
        wire = Wire(answered())
        assert ask(check, repo, out, monkeypatch, wire, task="OTHER-001") == check.USAGE
        assert wire.requests == []


class TestTheReportIsRendered:
    def test_with_a_pr_the_record_names_it_and_jev_sits_beside_haiku(
        self, check, repo, out, monkeypatch
    ):
        ask(check, repo, out, monkeypatch, Wire(answered()))
        (out["work"] / "jev.json").write_text(json.dumps(jev_answers()), encoding="utf-8")
        assert render(check, out, pr="160") == check.OK
        comment = out["comment"].read_text(encoding="utf-8")
        assert comment.startswith(drift.MARKER)
        (record,) = shadow.decode(comment)
        assert record["automation"] == "spec_drift" and record["task"] == TASK
        assert record["pr"] == 160
        assert record["haiku"]["matches"] is False
        assert record["haiku"]["findings"] == 1 and record["haiku"]["names"] == ["Quarantined"]
        assert record["jev"]["choice"] == "no" and record["jev"]["confidence"] == 0.81
        assert record["agree"] is True
        assert "0.81" in out["summary"].read_text(encoding="utf-8")

    def test_without_a_pr_the_report_is_still_written(self, check, repo, out, monkeypatch):
        ask(check, repo, out, monkeypatch, Wire(answered()))
        assert render(check, out) == check.OK
        (record,) = shadow.decode(out["comment"].read_text(encoding="utf-8"))
        assert record["pr"] is None and record["jev"]["choice"] is None and record["agree"] is None

    def test_after_a_failed_call_the_free_findings_are_still_rendered(
        self, check, repo, out, monkeypatch
    ):
        ask(check, repo, out, monkeypatch, Wire(http_error(500)))
        assert render(check, out) == check.OK
        comment = out["comment"].read_text(encoding="utf-8")
        assert "02-deployment-requirements.md" in comment
        assert "no answer" in comment.lower()
        (record,) = shadow.decode(comment)
        assert record["haiku"]["matches"] is None

    def test_no_result_means_no_report(self, check, out):
        out["comment"].parent.mkdir(parents=True, exist_ok=True)
        out["comment"].write_text("stale", encoding="utf-8")
        assert render(check, out) == check.OK
        assert not out["comment"].exists()

    def test_a_pr_number_that_is_not_one_is_refused(self, check, repo, out, monkeypatch):
        ask(check, repo, out, monkeypatch, Wire(answered()))
        assert render(check, out, pr="160; rm -rf /") == check.USAGE
        assert not out["comment"].exists()


class TestTheKeyIsNeverPrinted:
    def test_the_key_appears_in_no_output(self, check, repo, out, monkeypatch, capsys):
        ask(check, repo, out, monkeypatch, Wire(http_error(401, f"bad x-api-key {KEY}".encode())))
        printed = capsys.readouterr()
        for text in (printed.out, printed.err, out["summary"].read_text(encoding="utf-8")):
            assert KEY not in text
