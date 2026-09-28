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
