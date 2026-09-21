#!/usr/bin/env python3
"""agentctl - the only supported way to touch agent workflow state.

Every GitHub Actions step and every human intervention goes through this CLI,
so there is exactly one implementation of "what happens next" and it is the
tested one. Workflow YAML stays a thin shell: read state, ask agentctl, do one
thing, write state.

  agentctl status                       board of every task
  agentctl task validate DEMO-001       check a spec before it is dispatched
  agentctl next DEMO-001                what the orchestrator should do now
  agentctl context DEMO-001             the exact context a worker gets
  agentctl state advance DEMO-001 -e CI_PASSED
  agentctl state control DEMO-001 --set PAUSE
  agentctl guard check DEMO-001 --role code_agent --base main --head HEAD
  agentctl distill DEMO-001 --log ci.txt --ci-status failure
  agentctl telemetry report
  agentctl selfcheck                    prove the machinery works, no tokens spent

Exit codes: 0 success, 1 the thing being checked failed, 2 usage/IO error.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = AI_ROOT.parent
sys.path.insert(0, str(AI_ROOT))

from agentlib import (
    agentresult as ares,
)
from agentlib import (
    ciresult,
    guard,
    orchestrator,
    promptbuild,
)
from agentlib import (
    spec as spec_mod,
)
from agentlib import (
    state as st,
)
from agentlib import (
    telemetry as tm,
)

TASKS_DIR = AI_ROOT / "tasks"
SKILLS_DIR = AI_ROOT / "skills"

OK, FAILED, USAGE = 0, 1, 2


# --------------------------------------------------------------------------- helpers


def _json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def config() -> dict:
    return _json(AI_ROOT / "config.json")


def policy() -> dict:
    return _json(AI_ROOT / "policy.json")


def known_skills() -> set[str]:
    if not SKILLS_DIR.exists():
        return set()
    return {d.name for d in SKILLS_DIR.iterdir() if (d / "SKILL.md").exists()}


def task_dir(task_id: str) -> Path:
    d = TASKS_DIR / task_id
    if not spec_mod.TASK_ID_RE.match(task_id):
        die(f"{task_id!r} is not a valid task id")
    return d


def state_path(task_id: str) -> Path:
    return task_dir(task_id) / "state.json"


def load_spec(task_id: str) -> dict:
    try:
        return spec_mod.load(task_dir(task_id))
    except spec_mod.SpecError as exc:
        die(str(exc))
        raise  # unreachable; keeps the type checker honest


def draft_state(task_id: str, spec: dict) -> dict:
    """The state a task is in before anything has run: DRAFT, on disk nowhere.

    A spec with no state file is not an error — it is a task nobody has started.
    Treating it as one produced a chicken-and-egg that killed the first live
    orchestrator run: `next` refused to answer without a state file, and the
    action it would have returned (`validate`) is what creates that file.
    """
    policy_ = spec_mod.workflow_policy(spec)
    s = st.new_state(
        task_id,
        branch=spec_mod.branch_name(task_id),
        max_attempts=policy_["max_impl_attempts"],
    )
    s["require_red_baseline"] = policy_["require_red_baseline"]
    return s


def load_pair(task_id: str, require_state: bool = True) -> tuple[dict, dict]:
    spec = load_spec(task_id)
    p = state_path(task_id)
    if p.exists():
        return spec, st.load_state(p)
    if require_state:
        die(f"no state file for {task_id}; run `agentctl state init {task_id}`")
    return spec, draft_state(task_id, spec)


def emit(obj) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True))


def die(message: str, code: int = USAGE) -> None:
    print(f"agentctl: {message}", file=sys.stderr)
    raise SystemExit(code)


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        die(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


# --------------------------------------------------------------------------- task


def cmd_task_new(args) -> int:
    d = task_dir(args.task_id)
    if d.exists():
        die(f"{d} already exists")
    d.mkdir(parents=True)
    spec = {
        "schema": spec_mod.SCHEMA_VERSION,
        "task_id": args.task_id,
        "objective": args.objective or "TODO: one sentence, what this task must achieve.",
        "acceptance_criteria": ["TODO: observable, testable, one per line."],
        "allowed_paths": ["TODO/**"],
        "forbidden_paths": [],
        "required_context": ["wiki/CodeContext/Modules/0x00-architecture.md"],
        "required_skills": [],
        "workflow_policy": dict(spec_mod.WORKFLOW_POLICY_DEFAULTS),
    }
    (d / "task.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    (d / "brief.md").write_text(
        f"# {args.task_id}\n\n"
        "Prose for the Manager. Nothing parses this file; the contract is `task.json`.\n\n"
        "## Why this task exists\n\n## What 'done' looks like\n\n## Known constraints\n",
        encoding="utf-8",
    )
    print(f"created {d.relative_to(REPO_ROOT)}")
    return OK


def cmd_task_validate(args) -> int:
    try:
        spec = spec_mod.load(task_dir(args.task_id))
    except spec_mod.SpecError as exc:
        die(str(exc), FAILED)
    errors = spec_mod.validate(spec, known_skills())
    if errors:
        print(f"{args.task_id}: {len(errors)} problem(s)", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return FAILED
    print(f"{args.task_id}: spec is valid")
    return OK


def cmd_task_list(args) -> int:
    for d in sorted(TASKS_DIR.glob("*/task.json")):
        print(d.parent.name)
    return OK


# --------------------------------------------------------------------------- state


def cmd_state_init(args) -> int:
    spec = load_spec(args.task_id)
    errors = spec_mod.validate(spec, known_skills())
    if errors:
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        die(f"refusing to start an invalid spec ({len(errors)} problems)", FAILED)
    if state_path(args.task_id).exists():
        # Idempotent: the orchestrator may retry a run, and re-initialising
        # would silently discard a task's history.
        print(f"{args.task_id} already has state; leaving it alone", file=sys.stderr)
        emit(st.load_state(state_path(args.task_id)))
        return OK
    s = st.advance(draft_state(args.task_id, spec), "VALIDATED")
    st.save_state(state_path(args.task_id), s)
    emit(s)
    return OK


def cmd_state_show(args) -> int:
    _, s = load_pair(args.task_id)
    emit(s)
    return OK


def cmd_state_advance(args) -> int:
    spec, s = load_pair(args.task_id)
    ctx: dict = {"spec": spec}
    if args.reason:
        ctx["reason"] = args.reason
    if args.distilled:
        ctx["distilled"] = _json(Path(args.distilled))
    if args.ci_run_id or args.ci_conclusion:
        ctx["ci"] = {
            "run_id": args.ci_run_id,
            "conclusion": args.ci_conclusion,
            "commit": args.commit_sha,
        }
    if args.commit_sha:
        ctx["commit_sha"] = args.commit_sha
    if args.extra_attempts:
        ctx["extra_attempts"] = args.extra_attempts
    try:
        s = st.advance(s, args.event, **ctx)
    except st.Paused as exc:
        print(f"agentctl: {exc}", file=sys.stderr)
        return FAILED
    except st.StateError as exc:
        die(str(exc), FAILED)
    if args.session_id:
        s = st.record_session(s, args.role or "manager", args.session_id)
    st.save_state(state_path(args.task_id), s)
    emit(s)
    return OK


def cmd_state_control(args) -> int:
    _, s = load_pair(args.task_id)
    try:
        s = st.set_control(s, args.set)
    except st.StateError as exc:
        die(str(exc), FAILED)
    st.save_state(state_path(args.task_id), s)
    print(f"{args.task_id}: control={s['control']} state={s['state']}")
    return OK


# --------------------------------------------------------------------------- dispatch


def cmd_next(args) -> int:
    # require_state=False: a task that has never run is DRAFT, and the answer
    # is `validate`. This is the orchestrator's very first call on a new task.
    spec, s = load_pair(args.task_id, require_state=False)
    emit(orchestrator.next_action(s, spec))
    return OK


def cmd_context(args) -> int:
    """The exact payload a worker is started with.

    Printed rather than piped so a human can read what an agent was told
    before it ran, which is most of what `.ai/docs/operations.md` means by
    'inspect without opening an agent session'.
    """
    spec, s = load_pair(args.task_id)
    ctx = orchestrator.worker_context(s, spec)
    ctx["context_files"] = [
        str(REPO_ROOT / ref) for ref in ctx["required_context"] if (REPO_ROOT / ref).exists()
    ]
    ctx["skill_files"] = [
        str(SKILLS_DIR / name / "SKILL.md")
        for name in ctx["required_skills"]
        if (SKILLS_DIR / name / "SKILL.md").exists()
    ]
    emit(ctx)
    return OK


def cmd_prompt(args) -> int:
    """Assemble the exact prompt a worker will be started with."""
    spec, s = load_pair(args.task_id)
    ctx = orchestrator.worker_context(s, spec)
    ctx["role"] = args.role  # the workflow names the role; state confirms the rest
    ctx["context_files"] = [
        str(REPO_ROOT / ref) for ref in ctx["required_context"] if (REPO_ROOT / ref).exists()
    ]
    ctx["skill_files"] = [
        str(SKILLS_DIR / name / "SKILL.md")
        for name in ctx["required_skills"]
        if (SKILLS_DIR / name / "SKILL.md").exists()
    ]
    try:
        text = promptbuild.build(ctx, AI_ROOT)
    except promptbuild.PromptError as exc:
        die(str(exc), FAILED)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    else:
        print(text)
    return OK


# ------------------------------------------------------------------- agent results


def cmd_summary_line(args) -> int:
    print(ares.summary_line(ares.parse(args.agent_result)))
    return OK


def cmd_manager_decision(args) -> int:
    print(ares.manager_decision(ares.parse(args.agent_result)))
    return OK


def cmd_session_id(args) -> int:
    print(ares.parse(args.agent_result).get("session_id") or "")
    return OK


def cmd_telemetry_from_run(args) -> int:
    """Record one invocation from a normalised agent result.

    Never fails the workflow: losing an accounting record must not lose the
    run. A problem here is reported as a warning and the step still succeeds.
    """
    cfg = config()
    if not cfg.get("telemetry", {}).get("enabled", True):
        return OK
    attempt = 0
    if state_path(args.task).exists():
        try:
            attempt = st.load_state(state_path(args.task))["attempt"]
        except st.StateError:
            pass
    rec = ares.telemetry_record(
        ares.parse(args.agent_result),
        task_id=args.task,
        role=args.role,
        attempt=attempt,
        workflow_run_id=args.workflow_run_id,
        started_at=args.started,
        outcome=args.result,
    )
    try:
        path = tm.record(
            REPO_ROOT / cfg["telemetry"]["root"], rec, prices=cfg["telemetry"].get("prices", {})
        )
    except tm.TelemetryError as exc:
        print(f"::warning::telemetry not recorded: {exc}", file=sys.stderr)
        return OK
    print(path.relative_to(REPO_ROOT))
    return OK


# --------------------------------------------------------------------------- guard


def cmd_guard_check(args) -> int:
    spec = spec_mod.load(task_dir(args.task_id))
    if args.diff_file:
        paths = [
            line.strip()
            for line in Path(args.diff_file).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    else:
        paths = [
            p for p in git("diff", "--name-only", f"{args.base}...{args.head}").splitlines() if p
        ]

    allow_test_edits = spec_mod.workflow_policy(spec)["allow_test_edits_during_impl"]
    result = guard.check_diff(paths, args.role, spec, policy(), allow_test_edits=allow_test_edits)

    if result.ok:
        print(f"guard: {len(paths)} path(s) OK for role {args.role} on {args.task_id}")
        return OK
    print(
        f"guard: {len(result.violations)} violation(s) for role {args.role} on {args.task_id}",
        file=sys.stderr,
    )
    print(guard.format_violations(result.violations), file=sys.stderr)
    return FAILED


# --------------------------------------------------------------------------- distil


def cmd_distill(args) -> int:
    log = Path(args.log).read_text(encoding="utf-8", errors="replace") if args.log else ""
    _, s = load_pair(args.task_id) if state_path(args.task_id).exists() else (None, None)
    attempt = args.attempt if args.attempt is not None else (s["attempt"] if s else 0)
    result = ciresult.distill(log, args.ci_status, args.task_id, attempt)
    if args.out:
        Path(args.out).write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    emit(result)
    return OK


# --------------------------------------------------------------------------- telemetry


def cmd_telemetry_record(args) -> int:
    cfg = config()
    root = REPO_ROOT / cfg["telemetry"]["root"]
    try:
        path = tm.record(root, _json(Path(args.file)), prices=cfg["telemetry"].get("prices", {}))
    except tm.TelemetryError as exc:
        die(str(exc), FAILED)
    print(path.relative_to(REPO_ROOT))
    return OK


def cmd_telemetry_report(args) -> int:
    cfg = config()
    summary = tm.aggregate(REPO_ROOT / cfg["telemetry"]["root"])
    if args.json:
        emit(summary)
        return OK
    t = summary["totals"]
    print(
        f"invocations {t['invocations']}  tokens {t['total_tokens']:,}  "
        f"cost ${t['estimated_cost_usd']:.4f}  escalations {t['escalations']}"
    )
    for scope in ("by_task", "by_role", "by_model"):
        if not summary[scope]:
            continue
        print(f"\n{scope.replace('_', ' ')}:")
        for key, b in sorted(summary[scope].items()):
            print(
                f"  {key:<34} {b['invocations']:>4} runs  {b['total_tokens']:>10,} tok  "
                f"${b['estimated_cost_usd']:.4f}"
            )
    if summary["unreadable"]:
        print("\nunreadable records:", file=sys.stderr)
        for rel in summary["unreadable"]:
            print(f"  {rel}", file=sys.stderr)
    return OK


# --------------------------------------------------------------------------- status


def cmd_status(args) -> int:
    rows = []
    # Keyed on task.json, not state.json: a task with a spec and no state is a
    # DRAFT waiting to start, and it belongs on the board. Keying on state
    # files is why a just-created task read as "no tasks".
    for task_file in sorted(TASKS_DIR.glob("*/task.json")):
        d = task_file.parent
        try:
            spec = spec_mod.load(d)
        except spec_mod.SpecError as exc:
            rows.append((d.name, "BAD SPEC", "-", "-", str(exc)[:60]))
            continue
        state_file = d / "state.json"
        try:
            s = st.load_state(state_file) if state_file.exists() else draft_state(d.name, spec)
        except (st.StateError, json.JSONDecodeError) as exc:
            rows.append((d.name, "UNREADABLE", "-", "-", str(exc)[:60]))
            continue
        action = orchestrator.next_action(s, spec)
        nxt = action["kind"] + (f":{action['role']}" if action.get("role") else "")
        rows.append(
            (
                s["task_id"],
                s["state"],
                s["control"],
                f"{s['attempt']}/{s['max_attempts']}",
                s.get("escalation_reason") or nxt,
            )
        )
    if not rows:
        print("no tasks")
        return OK
    print(f"{'TASK':<14}{'STATE':<26}{'CTRL':<7}{'ATT':<7}NEXT / REASON")
    for r in rows:
        print(f"{r[0]:<14}{r[1]:<26}{r[2]:<7}{r[3]:<7}{r[4]}")
    return OK


# --------------------------------------------------------------------------- selfcheck


def cmd_selfcheck(args) -> int:
    """Drive the machinery end to end with no model and no CI.

    This is the cheap, always-available proof that the workflow engine itself
    is sound: every committed spec validates, the policy loads, and a synthetic
    task walks the green path, the retry path and the escalation path.
    """
    problems: list[str] = []

    try:
        cfg, pol = config(), policy()
    except (OSError, json.JSONDecodeError) as exc:
        die(f"cannot load configuration: {exc}", FAILED)
    for role in ("manager", "test_agent", "code_agent", "distiller", "context_maintainer"):
        if role not in pol["roles"]:
            problems.append(f"policy.json has no entry for role {role}")
        if role not in cfg["roles"]:
            problems.append(f"config.json has no model for role {role}")

    skills = known_skills()
    for d in sorted(TASKS_DIR.glob("*/task.json")):
        try:
            spec = spec_mod.load(d.parent)
        except spec_mod.SpecError as exc:
            problems.append(str(exc))
            continue
        problems += [f"{d.parent.name}: {e}" for e in spec_mod.validate(spec, skills)]

    demo = {
        "task_id": "SELF-001",
        "allowed_paths": ["backend/app/**", "backend/tests/**"],
        "forbidden_paths": [],
        "workflow_policy": {"max_impl_attempts": 2, "run_context_maintainer": True},
    }

    # Green path.
    s = st.new_state("SELF-001", branch="agent/SELF-001", max_attempts=2)
    for event in ("VALIDATED", "DISPATCH_TEST_AGENT", "AGENT_COMMITTED", "CI_STARTED", "CI_FAILED"):
        s = st.advance(s, event)
    if s["state"] != "READY_FOR_IMPLEMENTATION":
        problems.append(f"red baseline did not open implementation (got {s['state']})")
    for event in ("DISPATCH_CODE_AGENT", "AGENT_COMMITTED", "CI_STARTED", "CI_PASSED"):
        s = st.advance(s, event, spec=demo)
    s = st.advance(s, "MAINTAINER_DONE")
    if s["state"] != "COMPLETE":
        problems.append(f"green path did not COMPLETE (got {s['state']})")

    # A green baseline must NOT open implementation.
    s = st.advance(st.new_state("SELF-002", max_attempts=2), "VALIDATED")
    for event in ("DISPATCH_TEST_AGENT", "AGENT_COMMITTED", "CI_STARTED", "CI_PASSED"):
        s = st.advance(s, event)
    if s["state"] != "MANAGER_REVIEW":
        problems.append(f"green baseline was not caught (got {s['state']})")

    # Retry loop terminates.
    s = st.advance(st.new_state("SELF-003", max_attempts=2), "VALIDATED")
    for event in ("DISPATCH_TEST_AGENT", "AGENT_COMMITTED", "CI_STARTED", "CI_FAILED"):
        s = st.advance(s, event)
    for _ in range(20):
        if s["state"] == "MANAGER_REVIEW":
            break
        action = orchestrator.next_action(s, demo)
        if action["kind"] == "dispatch_agent" and action["role"] == "code_agent":
            for event in ("DISPATCH_CODE_AGENT", "AGENT_COMMITTED", "CI_STARTED", "CI_FAILED"):
                s = st.advance(s, event, spec=demo)
        elif action["kind"] == "distill":
            s = st.advance(s, "DISTILLED", distilled={})
        else:
            problems.append(f"retry loop stalled at {s['state']} ({action})")
            break
    else:
        problems.append("retry loop did not terminate within 20 iterations")
    if s["attempt"] > 2:
        problems.append(f"retry loop exceeded its budget (attempt {s['attempt']})")

    # The guard refuses a worker reaching for the system's own boundaries.
    breach = guard.check_diff(
        [".github/workflows/agent-orchestrator.yml", ".ai/policy.json"],
        "code_agent",
        demo,
        pol,
    )
    if breach.ok:
        problems.append("guard did NOT stop a worker writing agent infrastructure")

    if problems:
        print(f"selfcheck: {len(problems)} problem(s)", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return FAILED
    print("selfcheck: state machine, guard, policy and every committed task spec are consistent")
    return OK


# --------------------------------------------------------------------------- wiring


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="agentctl", description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    task = sub.add_parser("task", help="task specifications").add_subparsers(
        dest="sub", required=True
    )
    t_new = task.add_parser("new", help="scaffold a spec (Director)")
    t_new.add_argument("task_id")
    t_new.add_argument("--objective")
    t_new.set_defaults(func=cmd_task_new)
    t_val = task.add_parser("validate", help="validate a spec before dispatch")
    t_val.add_argument("task_id")
    t_val.set_defaults(func=cmd_task_validate)
    task.add_parser("list").set_defaults(func=cmd_task_list)

    state = sub.add_parser("state", help="workflow state").add_subparsers(dest="sub", required=True)
    s_init = state.add_parser("init", help="create state.json and validate the spec")
    s_init.add_argument("task_id")
    s_init.set_defaults(func=cmd_state_init)
    s_show = state.add_parser("show")
    s_show.add_argument("task_id")
    s_show.set_defaults(func=cmd_state_show)
    s_adv = state.add_parser("advance", help="apply one workflow event")
    s_adv.add_argument("task_id")
    s_adv.add_argument("-e", "--event", required=True)
    s_adv.add_argument("--reason")
    s_adv.add_argument("--distilled", help="path to a distilled result JSON")
    s_adv.add_argument("--ci-run-id")
    s_adv.add_argument("--ci-conclusion")
    s_adv.add_argument("--commit-sha")
    s_adv.add_argument("--extra-attempts", type=int)
    s_adv.add_argument("--session-id", help="record a resumable provider session id")
    s_adv.add_argument("--role", help="which role the --session-id belongs to")
    s_adv.set_defaults(func=cmd_state_advance)
    s_ctl = state.add_parser("control", help="human stop/start")
    s_ctl.add_argument("task_id")
    s_ctl.add_argument("--set", required=True, choices=sorted(st.CONTROLS))
    s_ctl.set_defaults(func=cmd_state_control)

    p_next = sub.add_parser("next", help="what the orchestrator does now")
    p_next.add_argument("task_id")
    p_next.set_defaults(func=cmd_next)

    p_ctx = sub.add_parser("context", help="the exact payload a worker receives")
    p_ctx.add_argument("task_id")
    p_ctx.set_defaults(func=cmd_context)

    p_prompt = sub.add_parser("prompt", help="the exact prompt a worker is started with")
    p_prompt.add_argument("task_id")
    p_prompt.add_argument("--role", required=True, choices=sorted(promptbuild.ROLE_PROMPTS))
    p_prompt.add_argument("--out")
    p_prompt.set_defaults(func=cmd_prompt)

    for name, func in (
        ("summary-line", cmd_summary_line),
        ("manager-decision", cmd_manager_decision),
        ("session-id", cmd_session_id),
    ):
        sp = sub.add_parser(name, help=f"read {name.replace('-', ' ')} from an agent result")
        sp.add_argument("--agent-result", required=True)
        sp.set_defaults(func=func)

    tfr = sub.add_parser("telemetry-from-run", help="record one invocation (used by agent-worker)")
    tfr.add_argument("--task", required=True)
    tfr.add_argument("--role", required=True)
    tfr.add_argument("--started", required=True)
    tfr.add_argument("--workflow-run-id", required=True)
    tfr.add_argument("--agent-result", required=True)
    tfr.add_argument("--result", required=True)
    tfr.set_defaults(func=cmd_telemetry_from_run)

    g = sub.add_parser("guard", help="path permissions").add_subparsers(dest="sub", required=True)
    g_chk = g.add_parser("check", help="check a diff against role + task permissions")
    g_chk.add_argument("task_id")
    g_chk.add_argument("--role", required=True)
    g_chk.add_argument("--diff-file", help="file of changed paths, one per line")
    g_chk.add_argument("--base", default="main")
    g_chk.add_argument("--head", default="HEAD")
    g_chk.set_defaults(func=cmd_guard_check)

    d = sub.add_parser("distill", help="CI log -> bounded structured result")
    d.add_argument("task_id")
    d.add_argument("--log", help="path to the raw CI log")
    d.add_argument("--ci-status", required=True, choices=["success", "failure", "cancelled"])
    d.add_argument("--attempt", type=int)
    d.add_argument("--out", help="also write the result here")
    d.set_defaults(func=cmd_distill)

    tel = sub.add_parser("telemetry").add_subparsers(dest="sub", required=True)
    tel_rec = tel.add_parser("record")
    tel_rec.add_argument("--file", required=True)
    tel_rec.set_defaults(func=cmd_telemetry_record)
    tel_rep = tel.add_parser("report")
    tel_rep.add_argument("--json", action="store_true")
    tel_rep.set_defaults(func=cmd_telemetry_report)

    sub.add_parser("status", help="board of every task").set_defaults(func=cmd_status)
    sub.add_parser("selfcheck", help="prove the machinery works, no tokens spent").set_defaults(
        func=cmd_selfcheck
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
