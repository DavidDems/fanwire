---
type: decision
---

# 0024 - The test kit is closed to the code agent

Decision: 2026-10-08, the human; closed 2026-10-09.

## Context

The code agent's write scope covered `frontend/src/**` and denied only
`*.test.ts` and `*.test.tsx`. That left it able to write `frontend/src/test/**`,
the frontend's test kit: the msw handler factories and fixtures that decide
what the mocked server answers in every frontend test. A code agent that can
change what the server answers can turn a red test green without changing the
behaviour under test. `.ai/tests/test_policy.py` even required it, with a
`CODE_AGENT_MUST_WRITE` row for `frontend/src/test/server.ts`.
`frontend/src/**/__tests__/**` was the same hole in another directory.

## Choice

`frontend/src/test/**` and `frontend/src/**/__tests__/**` are in
`code_agent.deny` in `.ai/policy.json`. The test agent writes them. This
reverses the `CODE_AGENT_MUST_WRITE` row for `frontend/src/test/server.ts`.

## Consequences

- `agentctl guard check --role code_agent` rejects a diff that touches the
  test kit, as it rejects one touching a test file.
- `.ai/docs/permissions.md`'s list of what is not technically enforced no
  longer includes the test kit.
- A unit that needs a new msw handler or fixture gets it in the test commit,
  before the implementation.
