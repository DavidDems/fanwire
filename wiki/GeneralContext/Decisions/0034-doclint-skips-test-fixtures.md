---
type: decision
---

# 0034 - doclint skips test fixtures

Decision: 2026-11-13, the human.

## Context

`agentlib.doclint` checks the links and section citations of every tracked
Markdown file. Files under `.ai/tests/fixtures/` are frozen copies of documents
that tests rebuild: `media002-pre122/brief.md` is the `MEDIA-002` brief as it
was before a fix, and `test_spec_drift.py` needs it exactly as it was. Its
links were written for [`.ai/tasks/MEDIA-002/`](https://github.com/DavidDems/fanwire-archive/tree/b2807e9a2a4b59ed4f2ff74d174ceba0239fc908/.ai/tasks/MEDIA-002/), so they cannot resolve at the
fixture's depth, and repairing them would change the document the test
depends on.

The alternative was to keep six baseline entries for that one file in
`.ai/docs-baseline.json` forever. That was declined: a baseline is debt to be
paid down, and these entries could never be paid.

## Choice

- **Files under `.ai/tests/fixtures/` are data, not documents.** doclint does
  not check their own links or citations.
- **They stay link targets.** A document that links into a fixture is still
  checked, and the link must resolve.

This is the same rule doclint already applies to merged decisions: a frozen
copy is compared or referenced, not repaired.

## Consequences

- The fixture's six baseline entries can be pruned, and no new fixture adds
  debt.
- A broken link inside a fixture is invisible to the linter, by design; a
  fixture is checked by the test that uses it.
- `test_test_fixtures_are_data_not_documents` in `.ai/tests/test_doclint.py`
  pins the rule. The linter's reference is
  [doclint.md](../../../.ai/docs/doclint.md).
