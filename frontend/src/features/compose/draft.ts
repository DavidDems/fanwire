/**
 * The in-progress post, as the composer holds it.
 *
 * One shape, shared by all four patterns this unit is built from: the Builder
 * accumulates into it, the Memento captures it, the Prototype clones it and the
 * Mediator publishes it. It is deliberately *not* `CreatePostRequest` — the wire
 * shape has `is_reply`/`is_repost` flags that are derivable, and a `text` that is
 * nullable rather than empty. Turning one into the other is `PostBuilder.build()`
 * and nothing else has to know the rule.
 *
 * `emptyDraft()` is a function and never a module-level constant: a shared empty
 * draft is the defect that makes one composer's attachment appear in the next.
 */

export interface Draft {
  /** Exactly what is in the text box — untrimmed, because the user is still typing. */
  text: string;
  /** Ids of `Processed` media, in attachment order. */
  mediaIds: number[];
  /** The post being replied to, or `null` for a top-level post. */
  replyToPostId: number | null;
  /** The post being reposted, or `null`. */
  repostOfPostId: number | null;
}

/** A brand-new, empty draft. A fresh object — and a fresh array — every call. */
export function emptyDraft(): Draft {
  return { text: "", mediaIds: [], replyToPostId: null, repostOfPostId: null };
}

/**
 * A detached copy.
 *
 * `mediaIds` is copied explicitly: a spread alone shares the array, which every
 * "is it really independent?" test in this unit is written to catch.
 */
export function copyDraft(draft: Draft): Draft {
  return { ...draft, mediaIds: [...draft.mediaIds] };
}
