"""Local guards for agent sessions on a shared machine (backlog item 20).

Three small, stdlib-only checks, none of which a pipeline path depends on:

* `workspace_problems`: every npm workspace has `node_modules` installed.
* `stash_use`: a shell command invokes `git stash` (the stash stack is shared
  by every worktree of one clone, so one session's stash is another's).
* `port_collisions`: a host port that `docker compose` would publish is already
  taken on localhost.

`.ai/hooks/claude_pretool.py` wires the last two into a Claude Code
PreToolUse hook; `agentctl selfcheck --workspaces` and `agentctl preflight
ports` expose the first and third by hand.
"""

from __future__ import annotations

import os
import re
import socket
from dataclasses import dataclass
from pathlib import Path

# --------------------------------------------------------------------------- workspaces

_SKIP_DIRS = {"node_modules", ".git", ".ai", ".claude", "venv", ".venv"}


def workspaces(root: Path) -> list[Path]:
    """Immediate subdirectories of `root` that carry a package.json."""
    root = Path(root)
    return sorted(
        d for d in root.iterdir() if d.is_dir() and d.name not in _SKIP_DIRS and (d / "package.json").is_file()
    )


def workspace_problems(root: Path, env: dict | None = None) -> list[str]:
    """One message per workspace whose `node_modules` is absent or empty.

    Skipped (no problems) when `CI` is `true`: CI's `agent-infra-test` job runs
    selfcheck with no `npm install`, and the CI containers install their own.
    """
    env = os.environ if env is None else env
    if str(env.get("CI", "")).lower() == "true":
        return []
    problems = []
    for ws in workspaces(root):
        nm = ws / "node_modules"
        if not nm.is_dir() or not any(nm.iterdir()):
            problems.append(f"{ws.name}: node_modules is missing; run `npm ci` in {ws.name}/ (cd {ws.name} && npm ci)")
    return problems


# --------------------------------------------------------------------------- shell parsing

_SEPARATORS = ";&|\n"
_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_WRAPPERS = {"sudo", "env", "command", "time", "nohup", "exec", "xargs", "nice", "builtin"}
_SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "eval", "pwsh", "powershell", "cmd"}


def _basename(word: str) -> str:
    name = re.split(r"[\\/]", word)[-1].lower()
    return name[:-4] if name.endswith(".exe") else name


class _Parser:
    """Splits a shell command into simple commands (lists of words).

    Not a full shell: it understands quotes, backslashes, `; & | newline`
    separators, `$( )` and backtick substitutions (which become commands of
    their own) and heredoc bodies (skipped). Single-quoted text is literal.
    Unterminated constructs raise ValueError so the caller can refuse.
    """

    def __init__(self, text: str):
        self.s = text
        self.i = 0
        self.commands: list[list[str]] = []
        self.heredocs: list[str] = []

    def parse(self) -> list[list[str]]:
        self._run(close=None)
        return self.commands

    def _run(self, close: str | None) -> None:
        s, words, cur, have = self.s, [], [], False
        n = len(s)

        def end_word():
            nonlocal cur, have
            if have:
                words.append("".join(cur))
            cur, have = [], False

        def end_cmd():
            nonlocal words
            end_word()
            if words:
                self.commands.append(words)
            words = []

        while self.i < n:
            c = s[self.i]
            if close and c == close:
                self.i += 1
                end_cmd()
                return
            if c == "\\" and self.i + 1 < n:
                cur.append(s[self.i + 1])
                have = True
                self.i += 2
            elif c == "'":
                j = s.find("'", self.i + 1)
                if j < 0:
                    raise ValueError("unterminated single quote")
                cur.append(s[self.i + 1 : j])
                have = True
                self.i = j + 1
            elif c == '"':
                cur.append(self._dquote())
                have = True
            elif c == "$" and s.startswith("$(", self.i):
                self.i += 2
                self._run(close=")")
                have = True
            elif c == "`":
                self.i += 1
                self._run(close="`")
                have = True
            elif c == "<" and s.startswith("<<", self.i) and not s.startswith("<<<", self.i):
                m = re.match(r"<<-?\s*(['\"]?)([^\s'\"]+)\1", s[self.i :])
                if m:
                    self.heredocs.append(m.group(2))
                    self.i += m.end()
                else:
                    cur.append(c)
                    have = True
                    self.i += 1
            elif c == "\n":
                self.i += 1
                end_cmd()
                self._skip_heredocs()
            elif c in _SEPARATORS:
                self.i += 1
                end_cmd()
            elif c in " \t\r":
                self.i += 1
                end_word()
            else:
                cur.append(c)
                have = True
                self.i += 1
        if close:
            raise ValueError("unterminated substitution")
        end_cmd()

    def _dquote(self) -> str:
        """Consume a double-quoted string; substitutions inside become commands."""
        s, n = self.s, len(self.s)
        self.i += 1
        out = []
        while self.i < n:
            c = s[self.i]
            if c == '"':
                self.i += 1
                return "".join(out)
            if c == "\\" and self.i + 1 < n:
                out.append(s[self.i + 1])
                self.i += 2
            elif c == "$" and s.startswith("$(", self.i):
                self.i += 2
                self._run(close=")")
            elif c == "`":
                self.i += 1
                self._run(close="`")
            else:
                out.append(c)
                self.i += 1
        raise ValueError("unterminated double quote")

    def _skip_heredocs(self) -> None:
        s = self.s
        while self.heredocs:
            delim = self.heredocs.pop(0)
            while self.i < len(s):
                j = s.find("\n", self.i)
                line = s[self.i : (j if j >= 0 else len(s))]
                self.i = j + 1 if j >= 0 else len(s)
                if line.strip() == delim:
                    break


def _git_subcommand(words: list[str]) -> str | None:
    """First non-option word after `git`, skipping global options and values."""
    takes_value = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"}
    i = 1
    while i < len(words):
        w = words[i]
        if w in takes_value:
            i += 2
        elif w.startswith("-"):
            i += 1
        else:
            return w
    return None


def _head(words: list[str]) -> tuple[int, dict]:
    """Index of the real command after leading assignments and wrappers, plus
    the assignments seen."""
    assigns: dict[str, str] = {}
    i = 0
    while i < len(words):
        w = words[i]
        if _ASSIGN.match(w):
            k, _, v = w.partition("=")
            assigns[k] = v
            i += 1
        elif _basename(w) in _WRAPPERS:
            i += 1
        elif w.startswith("-") and i > 0 and _basename(words[i - 1]) in _WRAPPERS:
            i += 1
        else:
            break
    return i, assigns


def _simple_commands(command: str, depth: int = 0) -> list[list[str]]:
    """All simple commands, descending into `bash -c "..."`-style strings."""
    out = []
    for words in _Parser(command).parse():
        out.append(words)
        h, _ = _head(words)
        if depth < 4 and h < len(words) and _basename(words[h]) in _SHELLS:
            for w in words[h + 1 :]:
                if " " in w or ";" in w or "&" in w or "|" in w:
                    out += _simple_commands(w, depth + 1)
    return out


def stash_use(command: str) -> bool:
    """True if `command` runs `git stash` (any subcommand). Unsure refuses."""
    try:
        for words in _simple_commands(command):
            h, _ = _head(words)
            if h < len(words) and _basename(words[h]) == "git":
                if _git_subcommand(words[h:]) == "stash":
                    return True
    except Exception:
        # Could not parse: refuse only when the raw text looks like a stash.
        return re.search(r"\bgit\b[^\n]*\bstash\b", command) is not None
    return False


# --------------------------------------------------------------------------- compose ports


@dataclass(frozen=True)
class PublishedPort:
    service: str
    port: int
    env_var: str | None


@dataclass(frozen=True)
class Collision:
    service: str
    port: int
    env_var: str | None

    def message(self) -> str:
        fix = (
            f"set {self.env_var}=<a free port> (for example `$env:{self.env_var}=\"{self.port + 100}\"`) and rerun"
            if self.env_var
            else "the compose file hard-codes this port, so stop the other listener or edit the mapping"
        )
        return (
            f"port {self.port} (service `{self.service}`) is already bound on localhost; {fix}. "
            "Stop only processes you started: another session's containers, vite previews or servers "
            "may own it."
        )


def _compose_services(text: str) -> dict[str, dict]:
    """Minimal line parser for the parts of a compose file this needs:
    per service `ports`, `depends_on` and `profiles`."""
    services: dict[str, dict] = {}
    in_services, svc, section = False, None, None
    for raw in text.splitlines():
        line = re.sub(r"(^|\s)#.*$", "", raw).rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        body = line.strip()
        if indent == 0:
            in_services = body == "services:"
            svc = section = None
            continue
        if not in_services:
            continue
        if indent == 2 and body.endswith(":"):
            svc = body[:-1].strip()
            services[svc] = {"ports": [], "depends_on": [], "profiles": False}
            section = None
        elif svc and indent == 4:
            key, _, rest = body.partition(":")
            section = key.strip()
            rest = rest.strip()
            if section == "profiles" and rest not in ("", "[]"):
                services[svc]["profiles"] = True
            elif section == "profiles":
                services[svc]["profiles"] = True  # block list below
            elif section == "depends_on" and rest.startswith("["):
                services[svc]["depends_on"] += [x.strip().strip("'\"") for x in rest.strip("[]").split(",") if x.strip()]
            elif section == "ports" and rest.startswith("["):
                services[svc]["ports"] += [x.strip().strip("'\"") for x in rest.strip("[]").split(",") if x.strip()]
        elif svc and section == "ports" and body.startswith("-") and indent > 4:
            services[svc]["ports"].append(body[1:].strip().strip("'\""))
        elif svc and section == "depends_on" and indent >= 6:
            if body.startswith("-"):
                services[svc]["depends_on"].append(body[1:].strip().strip("'\""))
            elif indent == 6 and body.endswith(":"):
                services[svc]["depends_on"].append(body[:-1].strip())
    return services


_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)")


def _resolve(value: str, env: dict) -> tuple[str, str | None]:
    """Substitute `${VAR:-default}` and friends; also return the first variable."""
    first: list[str] = []

    def sub(m):
        name = m.group(1) or m.group(4)
        first.append(name)
        op, arg = m.group(2), m.group(3) or ""
        val = env.get(name)
        if op in (":-", "-"):
            return val if (val not in (None, "") if op == ":-" else val is not None) else arg
        return val or ""

    return _VAR.sub(sub, value), (first[0] if first else None)


def _dotenv(compose_file: Path) -> dict:
    out = {}
    try:
        for line in (compose_file.parent / ".env").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip().strip("'\"")
    except OSError:
        pass
    return out


def published_ports(
    compose_file: Path,
    env: dict | None = None,
    services: list[str] | None = None,
    deps: bool = True,
    own_ports: bool = True,
    skip_profiles: bool = False,
) -> list[PublishedPort]:
    """Host ports compose would publish.

    `services=None` means every service (those with a compose profile only
    unless `skip_profiles`). With names, those
    services plus (when `deps`) everything they transitively depend on; a named
    service's own ports are skipped when `own_ports` is false (the case for
    `docker compose run` without `--service-ports`).
    """
    compose_file = Path(compose_file)
    env = {**_dotenv(compose_file), **(os.environ if env is None else env)}
    table = _compose_services(compose_file.read_text(encoding="utf-8"))
    if services is None:
        chosen = [n for n, d in table.items() if not (skip_profiles and d["profiles"])]
        roots: set[str] = set()
    else:
        roots = {s for s in services if s in table}
        chosen = list(roots)
        if deps:
            todo = list(roots)
            while todo:
                for dep in table[todo.pop()]["depends_on"]:
                    if dep in table and dep not in chosen:
                        chosen.append(dep)
                        todo.append(dep)
    found = []
    for name in chosen:
        if name in roots and not own_ports:
            continue
        for spec in table[name]["ports"]:
            resolved, var = _resolve(spec, env)
            parts = resolved.split("/")[0].split(":")
            if len(parts) < 2:
                continue  # container port only: ephemeral host port
            host = parts[-2]
            if host.isdigit():
                found.append(PublishedPort(name, int(host), var))
    return found


def is_bound(port: int, host: str = "127.0.0.1") -> bool:
    """True when something accepts a connection on localhost:port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0


def port_collisions(compose_file: Path, env: dict | None = None, **kw) -> list[Collision]:
    kw.setdefault("skip_profiles", True)  # profile-only services are not started by default
    return [
        Collision(p.service, p.port, p.env_var)
        for p in published_ports(compose_file, env=env, **kw)
        if is_bound(p.port)
    ]


# --------------------------------------------------------------------------- compose run detection

_COMPOSE_GLOBAL_VALUE = {"-f", "--file", "-p", "--project-name", "--profile", "--env-file", "--project-directory", "--ansi", "--parallel", "-c", "--context", "-H", "--host", "--progress"}
_RUN_VALUE = {"-e", "--env", "-v", "--volume", "-u", "--user", "-w", "--workdir", "--name", "--entrypoint", "-p", "--publish", "-l", "--label", "--cap-add", "--cap-drop", "--pull", "--env-from-file"}


@dataclass
class ComposeRun:
    service: str
    compose_file: str | None
    no_deps: bool
    service_ports: bool
    env: dict


def compose_run(command: str) -> ComposeRun | None:
    """The first `docker compose ... run ...` / `docker-compose run ...` in
    `command`, or None."""
    for words in _simple_commands(command):
        h, assigns = _head(words)
        if h >= len(words):
            continue
        head = _basename(words[h])
        rest = words[h + 1 :]
        if head == "docker-compose":
            pass
        elif head == "docker" and "compose" in rest:
            rest = rest[rest.index("compose") + 1 :]
        else:
            continue
        compose_file, i = None, 0
        while i < len(rest) and rest[i].startswith("-"):
            w = rest[i]
            if w in ("-f", "--file") and i + 1 < len(rest):
                compose_file = compose_file or rest[i + 1]
            elif w.startswith("--file="):
                compose_file = compose_file or w.split("=", 1)[1]
            i += 2 if w in _COMPOSE_GLOBAL_VALUE else 1
        if i >= len(rest) or rest[i] != "run":
            continue
        i += 1
        no_deps = service_ports = False
        while i < len(rest):
            w = rest[i]
            if not w.startswith("-"):
                return ComposeRun(w, compose_file, no_deps, service_ports, assigns)
            no_deps |= w == "--no-deps"
            service_ports |= w == "--service-ports"
            i += 2 if w in _RUN_VALUE else 1
        return None
    return None


def run_collisions(command: str, cwd: str | Path, env: dict | None = None) -> list[Collision]:
    """Collisions for the ports a `docker compose run` in `command` would
    publish; empty for any other command or a missing compose file."""
    run = compose_run(command)
    if run is None:
        return []
    cwd = Path(cwd)
    cf = Path(run.compose_file) if run.compose_file else Path("docker-compose.yml")
    cf = cf if cf.is_absolute() else cwd / cf
    if not cf.is_file():
        return []
    merged = {**(os.environ if env is None else env), **run.env}
    return port_collisions(
        cf,
        env=merged,
        services=[run.service],
        deps=not run.no_deps,
        own_ports=run.service_ports,
    )

