import type { components } from "../../api/schema";
import { copyDataLink, copyDataLinkOrNull, type DataLink } from "./dataLink";
import { copyDraft, emptyDraft, type Draft } from "./draft";

/**
 * Builder — assigned by `wiki/CodeContext/Standards/gof-patterns.md`, not chosen
 * here.
 *
 * The compose flow sets text, attachments and reply/repost context at different
 * moments and in no fixed order, so the request is accumulated across separate
 * calls rather than passed to one constructor. The validation lives in `build()`
 * for the same reason: it is the only moment at which the whole request exists.
 *
 * `canBuild()` is the same decision without the throw, because the submit control
 * needs it *before* the user presses the button, and a second copy of the rule in
 * the page is how the two drift apart.
 *
 * **The data link (`FRONTEND-013`).** `withDataLink` sets or clears the one
 * link, and `build()` sends it as `data_link` with only its own keys. With no
 * link the key is left out altogether rather than sent as `null`: a reply body
 * is pinned with `toEqual` in `ThreadModal.test.tsx`, and `null` would be a
 * different body. A link is not content on its own, so it never makes an
 * empty draft postable, and a quote repost that carries one needs text of its
 * own (the server's `data_link_needs_quote_text`), even beside an image.
 */

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

export class PostBuilder {
  private state: Draft = emptyDraft();

  /** Start from a draft that already exists — a template, or the live composer. */
  static from(draft: Draft): PostBuilder {
    const builder = new PostBuilder();
    // Copied, not held: the caller goes on editing the draft it handed over.
    builder.state = copyDraft(draft);
    return builder;
  }

  withText(text: string): this {
    this.state.text = text;
    return this;
  }

  addMediaId(mediaId: number): this {
    if (!this.state.mediaIds.includes(mediaId))
      this.state.mediaIds.push(mediaId);
    return this;
  }

  removeMediaId(mediaId: number): this {
    this.state.mediaIds = this.state.mediaIds.filter((id) => id !== mediaId);
    return this;
  }

  replyTo(postId: number | null): this {
    this.state.replyToPostId = postId;
    return this;
  }

  repostOf(postId: number | null): this {
    this.state.repostOfPostId = postId;
    return this;
  }

  /** Attach one link, replacing any before it, or clear it with `null`. Copied. */
  withDataLink(link: DataLink | null): this {
    this.state.dataLink = copyDataLinkOrNull(link);
    return this;
  }

  /** What has been accumulated so far, as a copy. */
  draft(): Draft {
    return copyDraft(this.state);
  }

  /**
   * Whether there is anything to post.
   *
   * Reply and repost context are *context*, not content: a draft whose only
   * content is a reply target is still an empty post. So is a data link: it
   * is something the post is about, not something it says.
   *
   * The one rule the link adds is the server's: a quote repost with a link
   * needs text. An image does not stand in for it there, as it does anywhere
   * else.
   */
  canBuild(): boolean {
    if (this.state.text.trim() !== "") return true;
    if (this.state.mediaIds.length === 0) return false;
    return !(
      this.state.repostOfPostId !== null && this.state.dataLink !== null
    );
  }

  build(): CreatePostRequest {
    if (!this.canBuild()) {
      throw new Error(
        this.state.repostOfPostId !== null && this.state.dataLink !== null
          ? "A repost with stats attached needs some text."
          : "A post needs some text or at least one image.",
      );
    }

    const text = this.state.text.trim();
    const link = this.state.dataLink;

    return {
      // `Post.text` is nullable and a post may be image-only. An empty string is
      // a different value and is not what the column means.
      text: text === "" ? null : text,
      media_ids: [...this.state.mediaIds],
      is_reply: this.state.replyToPostId !== null,
      parent_post_id: this.state.replyToPostId,
      is_repost: this.state.repostOfPostId !== null,
      original_post_id: this.state.repostOfPostId,
      // Absent, not `null`, when there is none (see the class comment).
      ...(link === null ? {} : { data_link: copyDataLink(link) }),
    };
  }
}
