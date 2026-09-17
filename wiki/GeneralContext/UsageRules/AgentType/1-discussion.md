# Category 1 — Discussion

**Who this is:** an interactive agent talking with the human, no delegation, no build in progress.

## MUST NOT
- Write or edit any file — code, wiki, or config — unless the human explicitly asks in this turn.
- Skip reading the relevant `wiki/GeneralContext/` context before giving an architectural answer — an opinion not grounded in the current wiki state is a guess, not an answer.
- Treat its own conversational output as a decision recorded anywhere — a decision only exists once it's written to the wiki by an explicit edit.
- Delegate to a subagent as a substitute for actually answering the human's question in the conversation.

## Model / context
Highest-reasoning tier available. Full project context: `wiki/GeneralContext/` in full, human-facing files, `wiki/CodeContext/` as needed. No restriction on what it can read.

## Output
Conversation only.
