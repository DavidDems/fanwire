# Skills

A skill is a small, reusable slice of *how this repo does a thing*, loaded only
by the tasks that need it. A task declares what it needs:

```json
"required_skills": ["backend-testing", "git-workflow"]
```

and `agentctl context <TASK-ID>` resolves those names to file paths. A worker
gets exactly those files. It does not get the others, and it does not go
looking — `.ai/skills/` is not in any worker's read set beyond what it was
handed.

## Layout

```
.ai/skills/<name>/SKILL.md
```

One directory, one `SKILL.md`. A skill with supporting files puts them
alongside and references them by relative path. The directory name is the
identifier used in `required_skills`, and `agentctl task validate` rejects a
spec naming a skill that has no `SKILL.md`.

## What belongs in a skill

Repo-specific mechanics an agent cannot infer and should not re-derive: the
exact commands, the fixtures that already exist, the trap that bit someone
last time. A skill is not a tutorial on the underlying technology — assume the
model knows pytest, assume it does not know `backend/tests/conftest.py` exists
and why.

## What does not

- Architecture and module decisions. Those are `wiki/CodeContext/`, and they
  reach a worker through the task spec's `required_context`, not through here.
- Anything a worker is forbidden to do. Permissions are enforced in
  `.ai/policy.json`, not stated in prose that an agent may or may not follow.

## Adding one

Skills are Director-owned: they live under `.ai/`, which is in
`guard.ALWAYS_FORBIDDEN`, so no worker can add, edit or delete one. New skills
land through an ordinary human-reviewed PR.

Keep them short. Three skills that are read beat nine that are skimmed.
