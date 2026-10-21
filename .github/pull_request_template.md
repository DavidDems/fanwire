## What and why

<!-- What this changes, and why. Link the task, prompt or issue. -->

## Before a production deploy

For a PR that touches `backend/app/`, tick one:

- [ ] Ran `powershell -File perf/run.ps1 -Profile load` locally on an otherwise
      idle machine. Pasted below: the PASS/FAIL line and the comparison table
      (or "baseline stored" on this machine's first run).
- [ ] N/A: no `backend/app/` change.

The `perf-advisory` CI job runs `smoke` on a shared runner and is not a
substitute: only the local `load` run is compared against a baseline.

<!-- perf output here -->
