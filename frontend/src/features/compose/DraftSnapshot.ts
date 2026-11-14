import { copyDraft, type Draft } from "./draft";

/**
 * Memento — assigned by `wiki/CodeContext/Standards/gof-patterns.md`.
 *
 * It captures an in-progress draft before a risky action (attaching live event
 * data) so the composer can roll back. What makes it a memento rather than a
 * variable holding the same object is that the captured state is *detached*:
 * `capture` copies in and `restore` copies out, so nothing that happens to the
 * draft afterwards — and nothing done to a restored draft — can reach the stored
 * one. A snapshot that kept the caller's object looks correct right up to the
 * first mutation, which is the only moment anyone would ever need it.
 *
 * `ComposeMediator` captures one before each attach or replace of a data link
 * (`FRONTEND-013`), and the link is part of what is captured: `copyDraft`
 * detaches it the way it detaches the media ids.
 *
 * The snapshot still captures the whole draft, but the mediator's `undo()`
 * takes back only its `dataLink`: text typed and media attached after the
 * attach are newer than the snapshot, and restoring them away would lose the
 * user's words — the failure `ComposePage` names as the worst it can have.
 */
export class DraftSnapshot {
  private readonly state: Draft;

  private constructor(state: Draft) {
    this.state = state;
  }

  static capture(draft: Draft): DraftSnapshot {
    return new DraftSnapshot(copyDraft(draft));
  }

  /** The captured draft — a fresh value on every call. */
  restore(): Draft {
    return copyDraft(this.state);
  }
}
