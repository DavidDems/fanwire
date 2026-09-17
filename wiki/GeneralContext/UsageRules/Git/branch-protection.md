# Branch protection

## MUST NOT
- Merge an agent-authored commit or PR without human approval — branch protection requires this on every branch, no exceptions for "obviously safe" changes.
- Attempt to bypass, disable, or reconfigure branch protection from within a task, ever — that is a human-only, out-of-band action.
- Auto-merge a category 3 or category 4 output. Category 3's CI runs distill to a report; category 4 always opens a PR/report for review. Neither merges itself.
- Skip CI checks (`--no-verify` or equivalent) to land a change faster.
