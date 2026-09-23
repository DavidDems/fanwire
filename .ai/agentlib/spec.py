"""Task specifications — the Director→Manager contract.

Format is JSON, not YAML, deliberately: `allowed_paths` is a security control,
and the deterministic core parses it with the standard library rather than a
third-party parser that would have to be installed into every orchestrator
step. Prose belongs in the sibling `brief.md`, which nothing parses.

A spec lives at `.ai/tasks/<TASK-ID>/task.json`.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

TASK_ID_RE = re.compile(r"^[A-Z][A-Z0-9]{0,15}-[0-9]{3,5}$")

REQUIRED_FIELDS = (
    "task_id",
    "objective",
    "acceptance_criteria",
    "allowed_paths",
    "forbidden_paths",
    "required_context",
    "required_skills",
    "workflow_policy",
)

# A spec may narrow a role's permissions; it may never grant one of these.
# Listing any of them is a spec authoring error, caught before dispatch rather
# than relied on being caught later by the guard.
UNGRANTABLE_PREFIXES = (".ai/", ".github/", "wiki/GeneralContext/")
UNGRANTABLE_EXACT = ("**", "*", "/", ".", "./**")

MAX_IMPL_ATTEMPTS_CEILING = 8

WORKFLOW_POLICY_DEFAULTS: dict[str, Any] = {
    "max_impl_attempts": 3,
    "require_red_baseline": True,
    "allow_test_edits_during_impl": False,
    "run_context_maintainer": True,
}


class SpecError(Exception):
    """A spec that cannot be safely loaded at all."""


def branch_name(task_id: str) -> str:
    """One branch per task, off `main`. Never per agent, never stacked.

    Stacked task branches are banned: a top-down merge of a stack can report
    success while nothing reaches `main`.
    """
    return f"agent/{task_id}"


def load(task_dir: str | Path) -> dict[str, Any]:
    d = Path(task_dir)
    path = d / "task.json"
    if not path.exists():
        raise SpecError(f"no task.json in {d}")
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SpecError(f"{path} is not valid JSON: {exc}") from exc
    if spec.get("task_id") != d.name:
        raise SpecError(f"task_id {spec.get('task_id')!r} disagrees with its directory {d.name!r}")
    return spec


def workflow_policy(spec: dict) -> dict[str, Any]:
    return {**WORKFLOW_POLICY_DEFAULTS, **spec.get("workflow_policy", {})}


def validate(spec: dict, known_skills: Iterable[str]) -> list[str]:
    """Return every problem found. An empty list means the spec may be dispatched."""
    errors: list[str] = []
    known = set(known_skills)

    for field in REQUIRED_FIELDS:
        if field not in spec:
            errors.append(f"missing required field: {field}")

    task_id = spec.get("task_id")
    if task_id is not None and (not isinstance(task_id, str) or not TASK_ID_RE.match(task_id)):
        errors.append(
            f"task_id {task_id!r} must match {TASK_ID_RE.pattern} "
            "(it is used verbatim as a directory and branch segment)"
        )

    if "objective" in spec and not _nonempty_str(spec["objective"]):
        errors.append("objective must be a non-empty string")

    if "acceptance_criteria" in spec and not _nonempty_str_list(spec["acceptance_criteria"]):
        errors.append("acceptance_criteria must be a non-empty list of strings")

    allowed = spec.get("allowed_paths")
    if allowed is not None:
        if not _nonempty_str_list(allowed):
            errors.append("allowed_paths must be a non-empty list of glob patterns")
        else:
            for pattern in allowed:
                if _is_ungrantable(pattern):
                    errors.append(
                        f"allowed_paths may not contain {pattern!r}: a task cannot grant "
                        "access to the agent system's own boundaries or to the whole repo"
                    )

    forbidden = spec.get("forbidden_paths")
    if forbidden is not None and not isinstance(forbidden, list):
        errors.append("forbidden_paths must be a list (it may be empty)")

    context = spec.get("required_context")
    if context is not None:
        if not isinstance(context, list):
            errors.append("required_context must be a list")
        else:
            for ref in context:
                if not isinstance(ref, str) or not ref.startswith("wiki/CodeContext/"):
                    errors.append(
                        f"required_context entry {ref!r} must live under wiki/CodeContext/ — "
                        "workers never receive GeneralContext"
                    )

    skills = spec.get("required_skills")
    if skills is not None:
        if not isinstance(skills, list):
            errors.append("required_skills must be a list")
        else:
            for skill in skills:
                if skill not in known:
                    errors.append(f"required_skills references unknown skill {skill!r}")

    if "workflow_policy" in spec:
        errors.extend(_validate_policy(spec["workflow_policy"]))

    errors.extend(_validate_maintainer_can_write(spec))

    return errors


def _validate_maintainer_can_write(spec: dict) -> list[str]:
    """`run_context_maintainer` with no wiki module in `allowed_paths` is a
    contradiction the machine can only discover by burning a run.

    A spec's `allowed_paths` NARROWS a role; it never widens one. The context
    maintainer's whole job is editing `wiki/CodeContext/Modules/*.md`, which
    `policy.json` grants it — but if the task does not also allow that path, the
    guard refuses the write as `outside_task_scope`, discards the work and
    escalates. That happens *after* the code agent has finished and CI has gone
    green, so the cost is a whole successful task landing in ESCALATED over
    bookkeeping. Run 35768890588.
    """
    policy = spec.get("workflow_policy")
    if not isinstance(policy, dict):
        return []
    if not policy.get("run_context_maintainer", WORKFLOW_POLICY_DEFAULTS["run_context_maintainer"]):
        return []

    allowed = spec.get("allowed_paths")
    if not isinstance(allowed, list):
        return []  # already reported by the allowed_paths check

    prefix = "wiki/CodeContext/Modules/"
    if any(isinstance(p, str) and p.startswith(prefix) and p.endswith(".md") for p in allowed):
        return []

    return [
        (
            "workflow_policy.run_context_maintainer is true but allowed_paths contains no "
            f"{prefix}*.md entry — the maintainer's only permitted write would be refused as "
            "outside_task_scope, escalating the task after the code agent has already "
            "succeeded. Add the module file this task documents, or set "
            "run_context_maintainer to false."
        )
    ]


def _validate_policy(policy: Any) -> list[str]:
    if not isinstance(policy, dict):
        return ["workflow_policy must be an object"]
    errors = []
    attempts = policy.get("max_impl_attempts", WORKFLOW_POLICY_DEFAULTS["max_impl_attempts"])
    if not isinstance(attempts, int) or not 1 <= attempts <= MAX_IMPL_ATTEMPTS_CEILING:
        errors.append(
            f"workflow_policy.max_impl_attempts must be an int in 1..{MAX_IMPL_ATTEMPTS_CEILING}"
        )
    for flag in ("require_red_baseline", "allow_test_edits_during_impl", "run_context_maintainer"):
        if flag in policy and not isinstance(policy[flag], bool):
            errors.append(f"workflow_policy.{flag} must be a boolean")
    return errors


def _is_ungrantable(pattern: str) -> bool:
    if pattern in UNGRANTABLE_EXACT:
        return True
    return any(pattern.startswith(prefix) for prefix in UNGRANTABLE_PREFIXES)


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _nonempty_str_list(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(_nonempty_str(v) for v in value)
