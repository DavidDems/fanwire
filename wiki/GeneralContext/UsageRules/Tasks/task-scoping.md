# Task scoping

Applies to every unit of work a manager dispatches, and to every task brief in `wiki/GeneralContext/Prompts/`.

## MUST NOT
- Dispatch a unit of work without a named module boundary it must not cross.
- Dispatch two units with a hidden shared integration point in parallel (e.g. two subagents both editing `PublishPostFacade`) — sequence those, parallelize only genuinely independent pieces.
- Leave a task's "definition of done" implicit — every dispatched task states what passing tests, which module boundary, and which wiki update (if any) mean it's finished.
- Let a task's scope grow mid-flight to cover something not in its original brief — if new scope is discovered, that's a new task with its own brief, not a silent expansion.
- Write a task brief that re-litigates a decision already settled in `wiki/GeneralContext/Architecture/business-rules.md` or a module's wiki file — cite the settled decision, don't reopen it.
- Have a task brief invent a blocker's resolution instead of flagging it — a known blocker (e.g. missing dataset, no live AWS) is stated as a blocker for the human, not worked around silently.
