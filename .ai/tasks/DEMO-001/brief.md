# DEMO-001 — the first end-to-end run

Prose for the Manager. Nothing parses this file; the contract is `task.json`.

## Why this task exists

This is the validation task for the agent workflow itself, not a feature
request. It exists so the first live run of the machinery is against something
where a bad outcome costs nothing.

Do not use a real feature as the first workflow test. Run this one, watch the
whole loop, then delete both the endpoint and this task directory if you want
to — nothing depends on either.

## Why this shape

It was chosen to exercise every stage while being close to inert:

- **It is additive.** Nothing existing changes behaviour. The third acceptance
  criterion pins that explicitly, so a code agent that breaks `/health` while
  adding `/health/version` fails CI rather than quietly regressing the app.
- **It has a real red baseline.** A test hitting `/health/version` before the
  route exists returns 404, so the baseline CI run genuinely fails — which is
  what the orchestrator requires before dispatching the code agent.
- **It runs the real suite.** `docker compose run --rm backend-test` is the
  same command CI uses for every other change. The demo is not special-cased
  anywhere.
- **It is two files.** `allowed_paths` is tight enough that a guard violation
  is unambiguous if one happens.

`run_context_maintainer` is `false`: a demo endpoint resolves no documented
decision, so there is nothing for the wiki to record. That flag is the right
lever for any task where the honest answer is "the wiki does not change".

## What to watch

The point of the run is the transitions, not the endpoint. Follow it with:

```
python .ai/bin/agentctl.py status
python .ai/bin/agentctl.py state show DEMO-001
python .ai/bin/agentctl.py telemetry report
```

Expected path:

```
DRAFT -> READY -> TEST_AGENT_RUNNING -> TESTS_COMMITTED -> BASELINE_CI
      -> READY_FOR_IMPLEMENTATION -> CODE_AGENT_RUNNING -> IMPL_COMMITTED
      -> IMPL_CI -> COMPLETE
```

If `BASELINE_CI` goes green, the test agent wrote a test that passes without an
implementation, and the task correctly lands in `MANAGER_REVIEW` instead. That
is a successful demonstration too — it is the red-baseline check doing its job.

## Known constraints

- `backend/app/main.py` is shared by every module's router. The change is a
  single route function; anything larger is out of scope.
- The version string should come from the installed package metadata rather
  than a hard-coded literal, since `backend/pyproject.toml` already carries it
  and the code agent is not permitted to edit that file.
