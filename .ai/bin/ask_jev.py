#!/usr/bin/env python3
"""Ask jev a set of typed questions about a state. The second provider seam.

  ask_jev.py --questions .ai/questions/smoke.json \
             --state-file .ai/questions/smoke-state.txt \
             --out answers.json [--summary FILE] [--require-confidence]
             [--automation NAME]

`.ai/bin/invoke_agent.sh` is the seam for "run an agent and let it work". This
is the seam for "ask a bounded question and get a typed answer". They are kept
apart on purpose: forcing a request/response decision API through a
CLI-agent-shaped interface would mean inventing a prompt file and a prose
trailer for something that has neither.

The route is TypeSafe's own endpoint, named in `.ai/config.json`
`providers.jev` with the key in `TYPESAFE_API_KEY`
(Prompts/04-cheap-automations.md Deliverable 0). The answer shapes are read by
`agentlib.decision`, which documents them.

work-modes.md "Constraints every automation must keep", as this script keeps
them:
  - bounded spend: exactly one request per run. No retry, on any status. A
    retry is a loop, and a loop is how a cheap automation stops being cheap.
  - fail quiet: `--out` is written with an empty answers map BEFORE the
    request goes out, so a crash, a timeout or a 500 still leaves a file that
    reads as "no answer". Shadow mode acts on nothing, so no answer is a safe
    outcome.
  - recorded cost: priced from the usage the response reports, against
    config.json's `telemetry.prices`.
  - the key is never printed: it goes into one header and nowhere else, and
    is redacted from any remote text before that text is written anywhere.

`--automation NAME` names the `.ai/config.json` `automations` entry that is
asking. If that entry's `ask_jev` is not exactly true, jev is switched off for
it: no key is read, no request goes out, `--out` is written with `"off": true`
(so a reader tells "switched off" from "asked, no answer"), and the exit is 0.
An entry that is missing is a usage error. Without it, jev is always asked
(the smoke does this).

Exit 0 the call completed (and, with `--require-confidence`, every answer
carried what its type promises); 1 it did not; 2 the invocation itself is
wrong.

Stdlib only, no `typesafe-sdk`: this runs in CI steps that install nothing,
and the request is one POST with a JSON body. A dependency whose whole job is
to build that body is a supply-chain decision with no payoff.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# Inserted explicitly: the smoke job runs this with `python -I`, which keeps
# the script's own directory (and the working directory) off sys.path.
AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import decision

OK, FAILED, USAGE = 0, 1, 2
PROVIDER = "jev"
REDACTED = "***"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ask_jev.py", description=__doc__.splitlines()[0])
    ap.add_argument("--questions", required=True, help="a .ai/questions/*.json file")
    ap.add_argument("--state-file", required=True, help="the state document to reason over")
    ap.add_argument("--out", required=True, help="where to write the typed answers")
    ap.add_argument("--timeout", type=float, default=30.0, help="seconds for the one request")
    ap.add_argument("--summary", help="a markdown file to append a readable account to")
    ap.add_argument(
        "--require-confidence",
        action="store_true",
        help="fail unless every answer carries what its type promises (the smoke's gate)",
    )
    ap.add_argument(
        "--automation",
        help="the config.json automations entry asking; its ask_jev must be true to ask",
    )
    args = ap.parse_args(argv)

    out_path = Path(args.out)
    summary = Path(args.summary) if args.summary else None
    config = _config()
    provider = config.get("providers", {}).get(PROVIDER, {})
    model = provider.get("model")
    endpoint = provider.get("endpoint")
    key_var = provider.get("api_key_env")

    # Written before anything else can fail, so every reader downstream has a
    # parseable file even if this process dies on the next line.
    _write(out_path, _record(model))

    if args.automation is not None:
        entry = config.get("automations", {}).get(args.automation)
        if not isinstance(entry, dict):
            return _give_up(
                out_path,
                summary,
                model,
                f"config.json has no automation {args.automation!r}",
                USAGE,
            )
        if entry.get("ask_jev") is not True:
            record = _record(model)
            record["off"] = True
            _write(out_path, record)
            note = f"jev is switched off for {args.automation} in config.json; not asked"
            if summary is not None:
                try:
                    with summary.open("a", encoding="utf-8") as fh:
                        fh.write(f"### jev\n\n- {note}\n\n")
                except OSError as exc:
                    print(f"::warning::cannot write the summary: {exc}", file=sys.stderr)
            print(f"::notice::{note}")
            return OK

    if not (isinstance(model, str) and isinstance(endpoint, str) and isinstance(key_var, str)):
        return _give_up(out_path, summary, model, "config.json has no usable providers.jev", USAGE)

    try:
        doc = decision.load_questions(args.questions)
    except decision.QuestionError as exc:
        # A repository bug, not a runtime blip: the tests should have caught it.
        return _give_up(out_path, summary, model, str(exc), USAGE)

    try:
        state = Path(args.state_file).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return _give_up(out_path, summary, model, f"cannot read state file: {exc}", USAGE)

    api_key = os.environ.get(key_var, "").strip()
    if not api_key:
        return _give_up(out_path, summary, model, f"{key_var} is not set", FAILED)

    capped = decision.cap_state(state)
    if len(capped) < len(state):
        print(f"::warning::state cut from {len(state)} to {len(capped)} characters")

    payload = {"model": model, "state": capped, "questions": decision.wire_questions(doc)}
    body, error = _post(endpoint, api_key, payload, args.timeout)
    if error is not None:
        return _give_up(
            out_path, summary, model, _redact(error, api_key), FAILED, "jev call failed"
        )

    # Answers to questions this repository did not ask are dropped, not passed
    # through: the file is read by the workflow, so it carries only what was
    # declared here.
    raw_answers = body.get("answers")
    answers = {
        k: v
        for k, v in (raw_answers.items() if isinstance(raw_answers, dict) else ())
        if k in doc["questions"]
    }
    raw_usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    usage = {
        "input_tokens": _int(raw_usage.get("input_tokens")),
        # Documented as free, recorded anyway: telemetry that assumes a price
        # will never change is telemetry that silently goes wrong.
        "output_tokens": _int(raw_usage.get("output_tokens")),
    }
    price = _config().get("telemetry", {}).get("prices", {}).get(f"{PROVIDER}/{model}")
    answered_by = body.get("model") if isinstance(body.get("model"), str) else model
    record = _record(answered_by, answers=answers, usage=usage)
    record["cost_usd"] = decision.cost_usd(raw_usage, price)

    status = OK
    if args.require_confidence:
        incomplete = decision.missing_fields(doc, answers)
        if incomplete:
            record["error"] = "answer without the field its type promises: " + ", ".join(incomplete)
            print(f"::error::{record['error']}", file=sys.stderr)
            status = FAILED

    _write(out_path, record)
    _summarize(summary, record, doc)
    for key in doc["questions"]:
        print(f"  {key}: {_describe(doc['questions'][key], answers.get(key))}")
    print(f"answers -> {out_path}")
    return status


# --------------------------------------------------------------------------- the one call


def _post(
    endpoint: str, api_key: str, payload: dict[str, Any], timeout: float
) -> tuple[dict[str, Any], str | None]:
    """One POST, no retry. Returns `(body, None)` or `({}, reason)`.

    Every failure is final, a 429 and a 503 included: the run's cost bound is
    one call, and the next event is the retry.
    """
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "fanwire-ask-jev/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # The body is remote text and can echo the request back, Authorization
        # header and all. It is redacted before it is cut, so a cut can never
        # leave a fragment of the key behind.
        detail = _redact(exc.read().decode("utf-8", "replace"), api_key)
        return {}, f"HTTP {exc.code}: {detail[:300]}".replace("\n", " ")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return {}, f"{type(exc).__name__}: {exc}"
    if not isinstance(body, dict):
        return {}, "the response is not a JSON object"
    return body, None


def _redact(text: str, secret: str) -> str:
    return text.replace(secret, REDACTED) if secret else text


# --------------------------------------------------------------------------- reporting


def _give_up(
    out_path: Path, summary: Path | None, model: object, error: str, status: int, what: str = ""
) -> int:
    """Record a run that produced no answers, say so, and return `status`."""
    record = _record(model, error=error)
    _write(out_path, record)
    _summarize(summary, record, None)
    print(f"::error::{what + ': ' if what else ''}{error}", file=sys.stderr)
    return status


def _summarize(path: Path | None, record: dict[str, Any], doc: dict[str, Any] | None) -> None:
    """Append a readable account of the run to `path` (the job's step summary).

    Remote strings are flattened to one inline-code span each, so an answer
    cannot add markdown of its own to the page.
    """
    if path is None:
        return
    lines = ["### jev", "", f"- model: `{_inline(record['model'])}`"]
    if doc is not None:
        for key, question in doc["questions"].items():
            described = _describe(question, record["answers"].get(key))
            lines.append(f"- `{_inline(key)}`: {_inline(described)}")
    usage = record["usage"]
    if usage:
        lines.append(
            f"- usage: {usage.get('input_tokens')} input tokens, "
            f"{usage.get('output_tokens')} output tokens"
        )
    cost = record.get("cost_usd")
    lines.append(f"- cost: ${cost:.6f}" if isinstance(cost, float) else "- cost: unpriced")
    if record["error"]:
        lines.append(f"- error: `{_inline(record['error'])}`")
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n\n")
    except OSError as exc:
        print(f"::warning::cannot write the summary: {exc}", file=sys.stderr)


def _describe(question: dict[str, Any], answer: object) -> str:
    """One readable line per answer, for the human reading the run."""
    if not isinstance(answer, dict):
        return "no answer"
    qtype = question.get("type")
    confidence = answer.get("confidence")
    if qtype == "noul":
        return f"noul={answer.get('noul')}"
    if qtype == "score":
        levels = question.get("criteria") or []
        level, _ = decision.score({"a": answer}, "a", levels)
        return f"score={answer.get('score')} level={level} confidence={confidence}"
    return f"choice={answer.get('choice')} confidence={confidence}"


def _inline(value: object) -> str:
    return " ".join(str(value).split()).replace("`", "'")[:200]


# --------------------------------------------------------------------------- plumbing


def _record(
    model: object,
    *,
    answers: dict[str, Any] | None = None,
    usage: dict[str, int] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "answers": answers or {},
        "usage": usage or {},
        "provider": PROVIDER,
        "model": model,
        "error": error,
        "cost_usd": None,
    }


def _config() -> dict[str, Any]:
    try:
        loaded = json.loads((AI_ROOT / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def _write(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
