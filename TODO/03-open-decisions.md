# 03 — Open decisions waiting on you

Questions agents have asked that only you can answer. Each one says what it
blocks.

**Answered decisions are not kept here.** They moved on 2026-10-02 to
[`wiki/GeneralContext/Architecture/human-decisions.md`](../wiki/GeneralContext/Architecture/human-decisions.md),
which keeps this file's old section numbers (§1–§5), and from there into the
file each one governs. Their old destination, `Prompts/phase-4-manager-agent.md`,
was deleted on 2026-09-29, so the "copy these across" step is gone.

---

## Browser automation — still unconfirmed

The frontend briefs ask for a real click-through of the running app. That needs
a browser tool an agent can drive: the Claude in Chrome extension or the
desktop app's built-in browser, allowed on `http://localhost:5173`. Until you
confirm one, every session reports browser verification as **NOT DONE**
(`human-decisions.md` §3). That matters more once the UI pass begins
(`Prompts/11`), because styling is exactly what jsdom tests cannot see.

- [ ] If you have a browser tool installed and allowed on `http://localhost:5173`,
      say so here. Sessions can then claim real browser verification. When you
      tick this, move the answer to `human-decisions.md` §3 and delete this
      section.

---

## How to answer

Answer in the file the question came from, or tell a session the answer. The
session records it in `human-decisions.md` and in the file the decision governs.
An answer kept only in `TODO/` is easy to lose: an agent reads `main`'s wiki,
not this folder.
