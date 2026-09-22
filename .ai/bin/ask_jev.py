#!/usr/bin/env python3
"""Ask a System One model a set of typed questions. The second provider seam.

  ask_jev.py --questions .ai/questions/manager.json \
             --state-file state.json \
             --out answers.json

`.ai/bin/invoke_agent.sh` is the seam for "run an agent and let it work". This
is the seam for "ask a bounded question and get a typed answer". They are kept
apart on purpose: forcing a request/response decision API through a
CLI-agent-shaped interface would mean inventing a prompt file and a prose
trailer for something that has neither.

Contract, in both directions:
  in  - a questions file (.ai/questions/*.json), and a state document
  out - <out> as {"answers": {...}, "usage": {...}, "provider": ..., "model": ...}
  exit 0 the call completed; non-zero it did not

Failure is not fatal by design. `--out` is written with an empty answers map
BEFORE the request goes out, so a crash, a timeout or a 500 leaves a file that
`agentlib.decision` reads as "no answer", which every gate turns into its
conservative fallback. The workflow keeps moving; it just moves the careful
way. See .ai/agentlib/decision.py.

Stdlib only, no `typesafe-sdk`: this runs in CI steps that install nothing but
pytest, and the request is one POST with a JSON body. A dependency whose whole
job is to build that body is a supply-chain decision with no payoff, and
backend/pyproject.toml deliberately keeps dependency additions a human call.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ROOT))

from agentlib import decision

OK, FAILED, USAGE = 0, 1, 2

# Retried: the request never reached a model, so sending it again is free of
# side effects. A 4xx is not here - a malformed body or a bad key does not get
# better by being sent three times.
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (0.5, 2.0)

# Jev's documented context budget covers the state plus every question. The
# state is assembled from repository files, which can be large, so it is
# truncated here rather than left to fail at the far end with a 4xx that costs
# a workflow step. Characters, not tokens: a stdlib script cannot tokenise, and
# a conservative character bound is the honest approximation.
MAX_STATE_CHARS = 180_000
TRUNCATION_NOTE = "\n\n[state truncated to fit the model's context budget]"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ask_jev.py", description=__doc__.splitlines()[0])
    ap.add_argument("--questions", required=True, help="a .ai/questions/*.json file")
    ap.add_argument("--state-file", required=True, help="the state document to reason over")
    ap.add_argument("--out", required=True, help="where to write the typed answers")
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args(argv)

    out_path = Path(args.out)
    config = _config()
    provider = config.get("providers", {}).get("jev", {})
    model = provider.get("model", "jev-latest")
    endpoint = provider.get("endpoint", "https://api.typesafe.ai/v1/systemone")
    key_var = provider.get("api_key_env", "TYPESAFE_API_KEY")

    # Written up front so every downstream reader has a parseable file even if
    # this process dies on the next line.
    _write(out_path, {"answers": {}, "usage": {}, "provider": "jev", "model": model, "error": None})

    try:
        doc = decision.load_questions(args.questions)
    except decision.QuestionError as exc:
        # A malformed questions file is a repository bug, not a runtime blip.
        # selfcheck should have caught it; say so loudly and stop.
        print(f"::error::{exc}", file=sys.stderr)
        return USAGE

    api_key = os.environ.get(key_var, "").strip()
    if not api_key:
        _fail(out_path, model, f"{key_var} is not set in this environment")
        print(f"::error::{key_var} is not set", file=sys.stderr)
        return FAILED

    try:
        state = Path(args.state_file).read_text(encoding="utf-8")
    except OSError as exc:
        _fail(out_path, model, f"cannot read state file: {exc}")
        print(f"::error::cannot read state file: {exc}", file=sys.stderr)
        return USAGE

    if len(state) > MAX_STATE_CHARS:
        print(f"::warning::state truncated from {len(state)} to {MAX_STATE_CHARS} chars")
        state = state[:MAX_STATE_CHARS] + TRUNCATION_NOTE

    # Only `questions` is sent. `gates` and every `_why` stay local: the
    # thresholds are this repository's policy, not input to the decision, and
    # telling a model what confidence it needs to clear is an invitation.
    payload = {
        "model": model,
        "state": state,
        "questions": {k: _wire(q) for k, q in doc["questions"].items()},
    }

    body, error = _post(endpoint, api_key, payload, args.timeout)
    if error is not None:
        _fail(out_path, model, error)
        print(f"::error::jev call failed: {error}", file=sys.stderr)
        return FAILED

    answers = body.get("answers", body)
    if not isinstance(answers, dict):
        answers = {}
    # Keys we did not ask about are dropped rather than passed through. The
    # file this writes is read by the workflow, so it carries only the fields
    # this repository declared.
    answers = {k: v for k, v in answers.items() if k in doc["questions"]}

    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    _write(
        out_path,
        {
            "answers": answers,
            "usage": {
                "input_tokens": _int(usage.get("input_tokens", usage.get("prompt_tokens"))),
                # Documented as free, recorded anyway: telemetry that assumes a
                # price will never change is telemetry that silently goes wrong.
                "output_tokens": _int(usage.get("output_tokens", usage.get("completion_tokens"))),
            },
            "provider": "jev",
            "model": body.get("model") or model,
            "error": None,
        },
    )

    missing = sorted(set(doc["questions"]) - set(answers))
    if missing:
        print(f"::warning::no answer returned for: {', '.join(missing)}")
    for key in sorted(answers):
        print(f"  {key}: {_describe(answers[key])}")
    print(f"answers -> {out_path}")
    return OK


def _wire(question: dict) -> dict:
    """Strip local-only annotation before a question goes on the wire."""
    return {k: v for k, v in question.items() if not k.startswith("_")}


def _post(endpoint: str, api_key: str, payload: dict, timeout: float) -> tuple[dict, str | None]:
    """POST with bounded retries. Returns `(body, None)` or `({}, reason)`."""
    data = json.dumps(payload).encode("utf-8")
    last = "no attempt made"

    for attempt in range(MAX_ATTEMPTS):
        request = urllib.request.Request(
            endpoint,
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "fanwire-agentctl/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8")), None
        except urllib.error.HTTPError as exc:
            # Read the body for the message, but never echo it verbatim into a
            # prompt later - it is remote text.
            detail = exc.read().decode("utf-8", "replace")[:300].replace("\n", " ")
            last = f"HTTP {exc.code}: {detail}"
            if exc.code not in RETRY_STATUS:
                return {}, last
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            last = f"{type(exc).__name__}: {exc}"

        if attempt < MAX_ATTEMPTS - 1:
            delay = BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)]
            print(f"::warning::jev attempt {attempt + 1} failed ({last}); retrying in {delay}s")
            time.sleep(delay)

    return {}, f"{MAX_ATTEMPTS} attempts failed; last: {last}"


def _describe(answer: object) -> str:
    """One readable line per answer, for the human reading the run log."""
    if not isinstance(answer, dict):
        return str(answer)
    confidence = answer.get("confidence")
    for field in ("choice", "score", "noul"):
        if field in answer:
            return f"{field}={answer[field]} confidence={confidence}"
    return f"confidence={confidence}"


def _config() -> dict:
    try:
        loaded = json.loads((AI_ROOT / "config.json").read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _int(value: object) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def _fail(path: Path, model: str, error: str) -> None:
    _write(path, {"answers": {}, "usage": {}, "provider": "jev", "model": model, "error": error})


def _write(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
