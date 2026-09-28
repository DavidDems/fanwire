import { DraftSnapshot } from "./DraftSnapshot";
import { copyDraft, emptyDraft, type Draft } from "./draft";
import { activeMentionLength, activeMentionQuery } from "./mentions";

/**
 * Mediator — assigned by `wiki/CodeContext/Standards/gof-patterns.md`.
 *
 * Three controls — the text box, the mention dropdown and the media widget —
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
 * The Memento is used here and only here: a mention insertion rewrites text the
 * user typed, so it captures a `DraftSnapshot` before it does, and `undo()` walks
 * back one insertion at a time.
 */

/** Who is reporting. Part of the Mediator's contract, not decoration. */
export type ComposeColleague = "text" | "mentions" | "media";

export type ComposeEvent =
  | { kind: "text-changed"; text: string }
  | { kind: "mention-inserted"; token: string }
  | { kind: "media-attached"; mediaId: number }
  | { kind: "media-detached"; mediaId: number };

export interface ComposeMediatorOptions {
  /** The post this composer was opened to reply to. */
  replyToPostId?: number | null;
  /** The post this composer was opened to repost. */
  repostOfPostId?: number | null;
}

/**
 * Replace the mention run at the end of `text` with `token`, plus one space.
 *
 * The trailing space is load-bearing: it is what `activeMentionQuery` reads as
 * closing the token, so the dropdown shuts and the next thing typed is a word
 * rather than more of the mention.
 */
function withMentionInserted(text: string, token: string): string {
  const active = activeMentionQuery(text);
  if (active === null) return `${text}${token} `;

  return `${text.slice(0, text.length - activeMentionLength(active))}${token} `;
}

export class ComposeMediator {
  /** The context the composer was opened in — what `reset()` returns to. */
  private readonly initial: Draft;

  private draft: Draft;

  private readonly listeners = new Set<() => void>();

  /** One entry per mention insertion, newest last. */
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

  /** A colleague reports what it did. Nobody calls another colleague. */
  send(from: ComposeColleague, event: ComposeEvent): void {
    switch (event.kind) {
      case "text-changed":
        this.publish({ ...this.draft, text: event.text });
        return;

      case "mention-inserted":
        // Captured *first*: undo restores what the user had before the rewrite,
        // and the rewrite touches text only — an attachment made before the
        // mention survives both the insertion and the undo.
        this.history.push(DraftSnapshot.capture(this.draft));
        this.publish({ ...this.draft, text: withMentionInserted(this.draft.text, event.token) });
        return;

      case "media-attached":
        if (this.draft.mediaIds.includes(event.mediaId)) return;
        this.publish({ ...this.draft, mediaIds: [...this.draft.mediaIds, event.mediaId] });
        return;

      case "media-detached":
        this.publish({
          ...this.draft,
          mediaIds: this.draft.mediaIds.filter((id) => id !== event.mediaId),
        });
        return;

      default:
        // Unreachable while `ComposeEvent` is exhaustive — and a fail-fast rather
        // than a silent no-op the day it stops being.
        throw new Error(`ComposeMediator has no route for what ${from} sent it.`);
    }
  }

  /** Whether there is a mention insertion to walk back. */
  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): void {
    const snapshot = this.history.pop();
    if (snapshot === undefined) return;
    this.publish(snapshot.restore());
  }

  /** Start from a whole draft — how a quick-post template is applied. */
  loadDraft(draft: Draft): void {
    // A different draft, so the insertions recorded against the old one are not
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
    for (const listener of this.listeners) listener();
  }
}
