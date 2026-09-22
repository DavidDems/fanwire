"""Path-permission enforcement.

This is the agent system's security boundary. Prompts, task briefs and role
descriptions are *advice*; this module is the *control*. A worker's diff is
checked here before it is allowed to stand, so a worker that was confused,
mis-prompted, or talked into something by untrusted repository text still
cannot widen its own blast radius.

Decision order (first match wins, and a denial is never overridden later):

1. `ALWAYS_FORBIDDEN`  — the system's own boundaries. No spec or policy can grant these.
2. task `forbidden_paths` — the Director's per-task carve-outs.
3. role `deny`          — the policy's explicit per-role denials.
4. role `write`         — the policy's per-role allowlist. No match => denied.
5. task `allowed_paths` — the spec narrows the role. It can never widen it.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

# Paths no agent role may ever write, regardless of policy.json or a task spec.
# `.ai/**` and `.github/**` are the boundary itself; `wiki/GeneralContext/**` is
# Director-owned semantic context that workers only ever read (and most never
# see at all).
ALWAYS_FORBIDDEN: tuple[str, ...] = (
    ".ai/**",
    ".github/**",
    "wiki/GeneralContext/**",
    ".gitignore",
    ".gitattributes",
    ".gitmodules",
    "AGENTS.md",
)

# The orchestrator's own bookkeeping, committed to a task branch by the
# workflow (never by an agent) so that a PR is self-documenting. These live
# under `.ai/`, so the PR-level guard would otherwise flag them as a boundary
# breach — it did, on the first real agent PR, and agent-guard is a required
# check, so nothing could have merged. Deliberately the narrowest possible
# carve-out: two paths, scoped to one task.
_BOOKKEEPING = (
    ".ai/tasks/{task_id}/state.json",
    ".ai/telemetry/runs/{task_id}/*.json",
)

# The role whose grants are merged in when a task sets
# `allow_test_edits_during_impl` — i.e. "the code agent may also do what the
# test agent may do, for this task only".
TEST_ROLE = "test_agent"

# A task id is interpolated into the bookkeeping patterns, so it is validated
# rather than trusted: a crafted id must not be able to widen them.
TASK_ID_SAFE = re.compile(r"^[A-Z][A-Z0-9]{0,15}-[0-9]{3,5}$")


@dataclass(frozen=True)
class Violation:
    path: str
    reason: str
    detail: str = ""


@dataclass(frozen=True)
class GuardResult:
    ok: bool
    violations: list[Violation] = field(default_factory=list)


def path_matches(path: str, pattern: str) -> bool:
    """Git-style glob match.

    `*` and `?` stop at a `/`; `**` crosses separators. `fnmatch` is not usable
    here precisely because its `*` happily crosses `/`, which would turn
    `backend/*` into a grant over the whole backend tree.
    """
    return _compile(pattern).fullmatch(_normalise(path)) is not None


def is_always_forbidden(path: str) -> bool:
    return any(path_matches(path, p) for p in ALWAYS_FORBIDDEN)


def is_orchestrator_bookkeeping(path: str, task_id: str) -> bool:
    """Is this the workflow's own state/telemetry for *this* task?

    Used only by the PR-level check in `.github/workflows/agent-guard.yml`,
    which sees a whole branch. A worker's own diff must still never contain
    these paths — `is_always_forbidden` continues to say so, and the per-role
    guard in the worker is unchanged.

    Note what is NOT bookkeeping: another task's records, `task.json` and
    `brief.md` (rewriting your own `allowed_paths` mid-task is precisely what
    the permission model exists to prevent), and anything else whatsoever.
    """
    if not TASK_ID_SAFE.match(task_id or ""):
        return False
    candidate = _normalise(path)
    if ".." in candidate.split("/"):
        return False
    return any(path_matches(candidate, p.format(task_id=task_id)) for p in _BOOKKEEPING)


def check_diff(
    changed_paths: Iterable[str],
    role: str,
    spec: dict,
    policy: dict,
    allow_test_edits: bool = False,
) -> GuardResult:
    """Check every path in a worker's diff. Reports *all* violations, not the first."""
    roles = policy.get("roles", {})
    paths = [_normalise(p) for p in changed_paths]

    if role not in roles:
        # Fail closed: an unrecognised role gets nothing, even an empty diff is
        # not worth special-casing into a pass.
        return GuardResult(
            ok=not paths,
            violations=[
                Violation(p, "unknown_role", f"no policy entry for role {role!r}") for p in paths
            ],
        )

    allow = list(roles[role].get("write", []))
    deny = list(roles[role].get("deny", []))
    if allow_test_edits and TEST_ROLE in roles:
        test_grants = roles[TEST_ROLE].get("write", [])
        allow += test_grants
        deny = [d for d in deny if d not in test_grants]

    task_allowed = spec.get("allowed_paths", [])
    task_forbidden = spec.get("forbidden_paths", [])

    violations: list[Violation] = []
    for path in paths:
        v = _check_one(path, allow, deny, task_allowed, task_forbidden)
        if v is not None:
            violations.append(v)
    return GuardResult(ok=not violations, violations=violations)


def _check_one(
    path: str,
    allow: Sequence[str],
    deny: Sequence[str],
    task_allowed: Sequence[str],
    task_forbidden: Sequence[str],
) -> Violation | None:
    if is_always_forbidden(path):
        return Violation(path, "always_forbidden", "agent-system boundary")
    if any(path_matches(path, p) for p in task_forbidden):
        return Violation(path, "task_forbidden", "listed in the task spec's forbidden_paths")
    if any(path_matches(path, p) for p in deny):
        return Violation(path, "role_denied", "explicitly denied to this role")
    if not any(path_matches(path, p) for p in allow):
        return Violation(path, "role_denied", "not in this role's write allowlist")
    if not any(path_matches(path, p) for p in task_allowed):
        return Violation(path, "outside_task_scope", "not in the task spec's allowed_paths")
    return None


def format_violations(violations: Sequence[Violation]) -> str:
    """Human- and log-readable rendering, used by the CI guard job."""
    return "\n".join(f"  {v.path}: {v.reason} ({v.detail})" for v in violations)


_CACHE: dict[str, re.Pattern[str]] = {}


def _normalise(path: str) -> str:
    """Repo-relative, forward-slashed. `git diff` on Windows and on the runner
    must produce the same string before any pattern is applied."""
    out = path.replace("\\", "/")
    while out.startswith("./"):
        out = out[2:]
    return out


def _compile(pattern: str) -> re.Pattern[str]:
    cached = _CACHE.get(pattern)
    if cached is not None:
        return cached
    out: list[str] = []
    i = 0
    p = _normalise(pattern)
    while i < len(p):
        c = p[i]
        if p.startswith("**/", i):
            out.append("(?:[^/]+/)*")
            i += 3
        elif p.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    compiled = re.compile("".join(out))
    _CACHE[pattern] = compiled
    return compiled
