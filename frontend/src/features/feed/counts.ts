import type { PostView } from "./api";

/**
 * The text beside each post control: "0 likes", "1 like", "1,000 replies".
 *
 * The number goes through `Intl.NumberFormat`, so thousands are separated the
 * way the viewer's locale separates them. The noun is chosen by hand, singular
 * at exactly one and the given plural otherwise: these are a few English nouns
 * with irregular plurals ("reply" → "replies"), and `Intl.PluralRules` would
 * only add a lookup to arrive at the same two words.
 *
 * One string, so it is one text node that a screen reader (and a test) reads
 * whole, outside the control's accessible name.
 */
export function countText(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${new Intl.NumberFormat().format(count)} ${count === 1 ? singular : plural}`;
}

/** The three counts a post card shows, each beside its control. */
export function likesText(post: PostView): string {
  return countText(post.like_count, "like", "likes");
}

export function repliesText(post: PostView): string {
  return countText(post.reply_count, "reply", "replies");
}

export function repostsText(post: PostView): string {
  return countText(post.repost_count, "repost", "reposts");
}
