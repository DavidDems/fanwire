import { copyDataLink, type DataLink } from "./dataLink";
import { DraftSnapshot } from "./DraftSnapshot";
import { copyDraft, emptyDraft, type Draft } from "./draft";

/**
 * Mediator — assigned by `wiki/CodeContext/Standards/gof-patterns.md`.
 *
 * Three controls — the text box, the attachment picker and the media widget —
 * each need to know what the other two are doing. That is the case the pattern
 * exists for, and the alternative (each importing the others) is the connection
 * rule violation this codebase keeps writing tests against. Here the colleagues
 * report what happened; the mediator owns the one draft they all read, and none
 * of them can name another.
 *
 * `getDraft()`/`subscribe()` are the `useSyncExternalStore` pair. **`getDraft()`
 * returns the same object until something changes the draft**: React compares the
 * snapshot by identity, so a fresh object per call is an infinite render loop
 * rather than a failing assertion. Every mutation therefore publishes a *new*
 * draft object and nothing ever edits the published one in place.
 *
 * The Memento is used here and only here: attaching a data link is the "risky
 * action (attaching live event data)" the pattern doc names, so the mediator
 * captures a `DraftSnapshot` before each attach or replace, and `undo()` walks
 * back one at a time — to the previous link, then to none.
 *
 * **Undo restores the attachment only.** It takes `dataLink` from the popped
 * snapshot and leaves the text, the media ids and the reply/repost context as
 * they are *now*. Restoring the whole captured draft would throw away anything
 * typed or attached since the attach, and `ComposePage` holds that losing a
 * user's typed text is the worst thing the composer can do. Undo is about the
 * stats; it must never cost the words. Removing a link is not captured: it
 * is already its own undo (attach again), and Undo after it still walks back
 * through the attaches that came before.
 *
 * Until `FRONTEND-013` the second colleague was the `#`/`$` mention dropdown and
 * the snapshot was taken before a mention rewrote the text. The dropdown is
 * gone (the human, 2026-10-22), and with it the `"mentions"` colleague and its
 * event: text is now only ever what the user typed.
 */

/** Who is reporting. Part of the Mediator's contract, not decoration. */
export type ComposeColleague = "text" | "attachment" | "media";

export type ComposeEvent =
  | { kind: "text-changed"; text: string }
  | { kind: "link-attached"; link: DataLink }
  | { kind: "link-removed" }
  | { kind: "media-attached"; mediaId: number }
  | { kind: "media-detached"; mediaId: number }
  | { kind: "media-checking"; checking: boolean };

export interface ComposeMediatorOptions {
  /** The post this composer was opened to reply to. */
  replyToPostId?: number | null;
  /** The post this composer was opened to repost. */
  repostOfPostId?: number | null;
}

export class ComposeMediator {
  /** The context the composer was opened in — what `reset()` returns to. */
  private readonly initial: Draft;

  private draft: Draft;

  private readonly listeners = new Set<() => void>();

  /** One entry per attach or replace of a data link, newest last. */
  private history: DraftSnapshot[] = [];

  /**
   * Bumped by `reset()`.
   *
   * The media widget holds state the draft does not — the chosen file's name and
   * the media row it is polling — and clearing the composer has to clear that
   * too, or a successful post leaves a stale thumbnail sitting over an empty
   * draft. The widget cannot see a reset in the draft alone (an empty draft and a
   * never-filled one are the same value), so it watches this counter.
   */
  private resets = 0;

  /**
   * Whether the media widget has an image on its way through the check
   * (`FRONTEND-020`). Not part of the draft (nothing is sent for it), but the
   * composer's submit waits on it: a post sent mid-check would drop the image
   * the reader is watching.
   */
  private checking = false;

  constructor(options: ComposeMediatorOptions = {}) {
    this.initial = {
      ...emptyDraft(),
      replyToPostId: options.replyToPostId ?? null,
      repostOfPostId: options.repostOfPostId ?? null,
    };
    this.draft = copyDraft(this.initial);
  }

  /**
   * Bound on the instance, so the value React is handed is stable across renders
   * and `useSyncExternalStore` does not resubscribe on every one.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getDraft = (): Draft => this.draft;

  readonly getResetCount = (): number => this.resets;

  /** The `useSyncExternalStore` snapshot of whether an image is being checked. */
  readonly isMediaChecking = (): boolean => this.checking;

  /** A colleague reports what it did. Nobody calls another colleague. */
  send(from: ComposeColleague, event: ComposeEvent): void {
    switch (event.kind) {
      case "text-changed":
        this.publish({ ...this.draft, text: event.text });
        return;

      case "link-attached":
        // Captured *first*, so undo can restore the link from before this
        // attach — the previous link on a replace, none on a first attach.
        // The picker's object is copied rather than held: it may go on to
        // change it, and the draft must not change with it.
        this.history.push(DraftSnapshot.capture(this.draft));
        this.publish({ ...this.draft, dataLink: copyDataLink(event.link) });
        return;

      case "link-removed":
        if (this.draft.dataLink === null) return;
        this.publish({ ...this.draft, dataLink: null });
        return;

      case "media-attached":
        if (this.draft.mediaIds.includes(event.mediaId)) return;
        this.publish({
          ...this.draft,
          mediaIds: [...this.draft.mediaIds, event.mediaId],
        });
        return;

      case "media-detached":
        this.publish({
          ...this.draft,
          mediaIds: this.draft.mediaIds.filter((id) => id !== event.mediaId),
        });
        return;

      case "media-checking":
        if (this.checking === event.checking) return;
        this.checking = event.checking;
        this.notify();
        return;

      default:
        // Unreachable while `ComposeEvent` is exhaustive — and a fail-fast rather
        // than a silent no-op the day it stops being.
        throw new Error(
          `ComposeMediator has no route for what ${from} sent it.`,
        );
    }
  }

  /** Whether there is an attach or replace to walk back. */
  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): void {
    const snapshot = this.history.pop();
    if (snapshot === undefined) return;
    // Only the link comes back; what was typed or attached since stays (see
    // the class comment). `restore()` hands out a detached copy of it.
    this.publish({ ...this.draft, dataLink: snapshot.restore().dataLink });
  }

  /** Start from a whole draft — how a quick-post template is applied. */
  loadDraft(draft: Draft): void {
    // A different draft, so the attaches recorded against the old one are not
    // something the user could meaningfully undo into.
    this.history = [];
    this.publish(draft);
  }

  /** Empty the composer, back to the context it was opened in. */
  reset(): void {
    this.history = [];
    this.resets += 1;
    this.publish(this.initial);
  }

  /**
   * Install the next draft and tell everyone.
   *
   * Copied on the way in, so neither `initial` nor a caller's object is ever the
   * live draft, and a new object every time, so the identity comparison
   * `useSyncExternalStore` makes actually sees the change.
   */
  private publish(next: Draft): void {
    this.draft = copyDraft(next);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
