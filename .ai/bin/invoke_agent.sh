#!/usr/bin/env bash
# The one provider-specific file in the system.
#
#   invoke_agent.sh <role> <prompt-file> <output-file>
#
# Everything else - the state machine, the guard, the prompts, the telemetry,
# the workflows - is provider-agnostic. Supporting a second provider means
# adding a branch to the `case` below and an entry in `.ai/config.json`. It
# means touching nothing in `.github/workflows/`.
#
# Contract, in both directions:
#   in  - a prompt file, and the role's provider/model from .ai/config.json
#   out - <output-file> in the shape .ai/agentlib/agentresult.py documents
#   exit 0 the agent ran; non-zero the invocation failed (-> AGENT_FAILED)
#
# This script runs with the provider credential in its environment and with NO
# GitHub token (see .github/workflows/agent-worker.yml). Keep it that way.

set -euo pipefail

ROLE="${1:?role required}"
PROMPT_FILE="${2:?prompt file required}"
OUT_FILE="${3:?output file required}"

# Code and data are found separately (handoff.md §10, D2b), exactly as in
# agentctl.py. AI_ROOT is where this script lives: in CI a checkout of `main`
# beside the task, so the provider config below is main's. REPO_ROOT is the
# tree the model works in: AGENTCTL_DATA_ROOT (the task checkout, in CI), or,
# unset, this checkout as before.
AI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${AGENTCTL_DATA_ROOT:-$(dirname "$AI_ROOT")}" && pwd)"

# `python -I` throughout: `python -` puts the working directory on sys.path,
# and a `json.py` there would be imported with the provider key in env.
read -r PROVIDER MODEL < <(
  python -I - "$AI_ROOT/config.json" "$ROLE" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
role = cfg["roles"].get(sys.argv[2])
if role is None:
    sys.exit(f"no model configured for role {sys.argv[2]!r}")
print(role["provider"], role["model"])
PY
)

echo "invoking role=$ROLE provider=$PROVIDER model=$MODEL"

# Written up front so a crash below still leaves a parseable result.
python -I - "$OUT_FILE" "$PROVIDER" "$MODEL" <<'PY'
import json, sys
json.dump(
    {
        "provider": sys.argv[2],
        "model": sys.argv[3],
        "session_id": None,
        "usage": {"input_tokens": 0, "output_tokens": 0},
        "summary": "invocation did not complete",
        "decision": None,
        "reason": None,
    },
    open(sys.argv[1], "w", encoding="utf-8"),
)
PY

RAW="$(mktemp)"
ERR="$(mktemp)"
trap 'rm -f "$RAW" "$ERR"' EXIT

case "$PROVIDER" in
  anthropic)
    command -v claude >/dev/null 2>&1 || {
      echo "::error::the 'claude' CLI is not installed on this runner" >&2
      exit 127
    }
    echo "cli: $(claude --version 2>&1 | head -1)"

    # --permission-mode acceptEdits: the agent edits files without prompting.
    # It is NOT trusted as a result - every edit is checked by the guard step
    # afterwards, which is where the real boundary is.
    #
    # `set +e` around the call on purpose. Under `set -e` the script died the
    # instant the CLI returned non-zero, before anything could be printed - and
    # in --print mode the CLI reports its errors on STDOUT, which is redirected
    # into $RAW. So the real message was captured into a temp file and thrown
    # away, and eight identical failed runs said only "exit code 1".
    # An automation whose failure is silent is worse than the step it replaced.
    #
    # Started in REPO_ROOT, the tree the model works on. The redirections sit
    # outside the subshell so relative paths keep meaning the caller's cwd.
    #
    # --setting-sources user / --strict-mcp-config (both in `claude --help`,
    # checked on 2.1.293): the CLI would otherwise load .claude/settings*.json
    # (whose hooks run commands) and .mcp.json (whose servers are processes)
    # from the task checkout, with the provider key in its environment
    # (handoff.md §10, D2b). In CI "user" is the unprivileged model user's
    # empty home. agent-worker.yml also refuses a branch that changed either.
    set +e
    (
      cd "$REPO_ROOT" && exec claude \
        --print \
        --output-format json \
        --model "$MODEL" \
        --permission-mode acceptEdits \
        --setting-sources user \
        --strict-mcp-config \
        --add-dir "$REPO_ROOT"
    ) < "$PROMPT_FILE" > "$RAW" 2> "$ERR"
    STATUS=$?
    set -e

    if [ "$STATUS" -ne 0 ]; then
      echo "::error::provider CLI exited $STATUS"
      echo "--- stderr (last 40 lines) ---"
      tail -40 "$ERR" || true
      echo "--- stdout (last 40 lines) ---"
      # Truncated and printed rather than dumped: this is provider output, and
      # the whole of it may be large. It is shown for a human reading the run
      # log; it is never fed back into a prompt.
      tail -40 "$RAW" || true
      echo "------------------------------"
      exit "$STATUS"
    fi
    # Surface warnings even on success - a run that worked but complained is
    # worth seeing before it becomes the next incident.
    [ -s "$ERR" ] && { echo "--- provider stderr ---"; tail -20 "$ERR"; }
    ;;
  *)
    echo "::error::unknown provider '$PROVIDER'; add a case here and to config.json" >&2
    exit 2
    ;;
esac

# Normalise the provider's native output into the shared contract. The agent's
# own structured trailer (a ```agent-result fenced block in its final message,
# see .ai/prompts/_shared.md) supplies summary/decision/reason; usage and
# session id come from the provider envelope.
python -I - "$RAW" "$OUT_FILE" "$PROVIDER" "$MODEL" <<'PY'
import json, re, sys

raw_path, out_path, provider, model = sys.argv[1:5]

try:
    envelope = json.loads(open(raw_path, encoding="utf-8").read())
except (OSError, json.JSONDecodeError):
    envelope = {}
if isinstance(envelope, list):  # some CLIs stream a list of events
    envelope = next((e for e in reversed(envelope) if isinstance(e, dict)), {})

usage = envelope.get("usage") or {}
text = envelope.get("result") or envelope.get("text") or ""

trailer = {}
match = re.search(r"```agent-result\s*(\{.*?\})\s*```", str(text), re.S)
if match:
    try:
        parsed = json.loads(match.group(1))
        if isinstance(parsed, dict):
            # Only these three fields are ever taken from model output.
            # Nothing else the model writes can influence the workflow.
            trailer = {k: parsed.get(k) for k in ("summary", "decision", "reason")}
    except json.JSONDecodeError:
        pass

json.dump(
    {
        "provider": provider,
        "model": envelope.get("model") or model,
        "session_id": envelope.get("session_id"),
        "usage": {
            "input_tokens": int(usage.get("input_tokens") or 0),
            "output_tokens": int(usage.get("output_tokens") or 0),
        },
        "summary": trailer.get("summary"),
        "decision": trailer.get("decision"),
        "reason": trailer.get("reason"),
    },
    open(out_path, "w", encoding="utf-8"),
    indent=2,
)
print(f"normalised result -> {out_path}")
PY
