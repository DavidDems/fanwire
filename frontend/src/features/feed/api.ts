import type { InfiniteData } from "@tanstack/react-query";

import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import { config } from "../../config";

/**
 * The endpoints this feature reads and writes, the cache keys their answers
 * live under, and the helpers that edit a cached post in place.
 *
 * Every type here is an alias of the generated schema — nothing in this folder
 * hand-writes an API shape, and all HTTP goes through `api/client.ts`.
 *
 * The keys are built by functions rather than spelled out in four components,
 * for the same reason `features/profile/api.ts` does it: the optimistic patch,
 * the rollback and the invalidation after them have to name the *same* entry by
 * construction rather than by three people spelling it the same way.
 */

export type FeedPageBody = components["schemas"]["FeedPage"];
export type MediaItemView = components["schemas"]["MediaItemView"];
export type PostView = components["schemas"]["PostView"];
export type ThreadView = components["schemas"]["ThreadView"];

/**
 * The prefix every entry this feature caches sits under.
 *
 * A post is not owned by one entry: it is in the page of the feed it arrived
 * on, again in every thread opened on it or on its parent, and inside every
 * repost of it. So the root is what a like cancels, patches and rolls back
 * across — the *exact* keys it then invalidates are the ones that turned out to
 * hold that post, which is narrower than the root and is computed rather than
 * assumed (see `TogglePostAction` in `PostAction.tsx`, and the thread modal's
 * refresh after a reply).
 */
export const FEED_KEY_ROOT = ["feed"] as const;

/**
 * `GET /feed`, as one infinite query.
 *
 * Every page of the feed is one cache entry, not one per cursor: react-query's
 * infinite query already keeps the pages in order and remembers the cursor that
 * fetched each, and a key that carried `before_id` would make page two a
 * different entry that page one's arrival could never extend.
 */
export const FEED_PAGES_KEY = ["feed", "pages"] as const;

/** `GET /feed/thread/{post_id}` — one entry per thread opened in the modal. */
export function threadKey(postId: number): readonly ["feed", "thread", number] {
  return ["feed", "thread", postId] as const;
}

/**
 * `GET /feed?before_id=`.
 *
 * The cursor is omitted entirely for the first page rather than sent as `null`:
 * the newest posts are what `GET /feed` answers with no cursor at all, and a
 * literal `before_id=null` in the query string is a value the route would have
 * to validate rather than a request for the first page.
 */
export async function fetchFeedPage(
  beforeId: number | null,
): Promise<FeedPageBody> {
  const query = beforeId === null ? {} : { before_id: beforeId };
  const { data, response } = await apiClient.GET("/feed", {
    params: { query },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /feed answered ${response.status}`);
  }
  return data;
}

/**
 * `GET /feed/thread/{post_id}` — the root plus its **direct** replies only
 * ([[0x06-feed]] Routes). There is no whole-thread read to call: a deeper level
 * is this same request against the reply that carries it.
 *
 * A 404 is `null`, not a failure: the post is unknown, or its author was
 * removed, and that is an answer the thread modal shows ("Post not found")
 * rather than an error it offers to retry. A root its owner deleted is a 200
 * with `root: null` and `root_deleted: true`, its surviving replies kept.
 */
export async function fetchThread(postId: number): Promise<ThreadView | null> {
  const { data, response } = await apiClient.GET("/feed/thread/{post_id}", {
    params: { path: { post_id: postId } },
  });
  if (response.status === 404) return null;
  if (!response.ok || data === undefined) {
    throw new Error(`GET /feed/thread/${postId} answered ${response.status}`);
  }
  return data;
}

/**
 * Like (`POST`) or unlike (`DELETE`) on the one path. Both answer 204, so there
 * is no body to read and `response.ok` is the whole result.
 */
export async function setLiked(postId: number, liked: boolean): Promise<void> {
  const options = { params: { path: { post_id: postId } } } as const;
  const { response } = liked
    ? await apiClient.POST("/posts/{post_id}/like", options)
    : await apiClient.DELETE("/posts/{post_id}/like", options);

  if (!response.ok) {
    throw new Error(
      `${liked ? "POST" : "DELETE"} /posts/${postId}/like answered ${response.status}`,
    );
  }
}

/**
 * Repost (`POST`) or undo it (`DELETE`) on the one path — the twin of
 * `setLiked`. `POST` answers 201 with the new repost, or 200 with the one the
 * viewer already had; `DELETE` answers 204. The body is not read: what the card
 * shows is the original's `reposted_by_viewer` and `repost_count`, which the
 * refetch after the toggle brings back. Any other status (a 409 for a repost
 * that has replies of its own, say) is a failure the card rolls back.
 */
export async function setReposted(
  postId: number,
  reposted: boolean,
): Promise<void> {
  const options = { params: { path: { post_id: postId } } } as const;
  const { response } = reposted
    ? await apiClient.POST("/posts/{post_id}/repost", options)
    : await apiClient.DELETE("/posts/{post_id}/repost", options);

  if (!response.ok) {
    throw new Error(
      `${reposted ? "POST" : "DELETE"} /posts/${postId}/repost answered ${response.status}`,
    );
  }
}

/**
 * The two cached shapes that can contain a post: a run of feed pages, and one
 * thread. Both are walked by the same two helpers below so that an optimistic
 * edit reaches every rendering of a post rather than only the one that was
 * clicked — the same post is on screen twice the moment a thread is opened on
 * a post the feed also lists. A thread read that answered 404 is cached as
 * `null`, which holds no post.
 *
 * **A repost carries a further copy** (UI-009): its `reposted_post` is the
 * original's own view, one level deep. A plain repost renders that copy as the
 * original's card, so both helpers look inside it too; otherwise liking an
 * original through a repost of it would leave the original's own card behind.
 */
export type FeedCacheValue =
  InfiniteData<FeedPageBody, number | null> | ThreadView | null;

/** Whether this post is `postId`, or reposts it. */
function holds(post: PostView, postId: number): boolean {
  return post.id === postId || post.reposted_post?.id === postId;
}

/** Whether this cached value has the post in it at all, a repost's original included. */
export function cacheHolds(
  value: FeedCacheValue | undefined,
  postId: number,
): boolean {
  if (value === undefined || value === null) return false;
  if ("pages" in value) {
    return value.pages.some((page) =>
      page.items.some((post) => holds(post, postId)),
    );
  }
  return (
    (value.root !== null && holds(value.root, postId)) ||
    value.replies.some((post) => holds(post, postId))
  );
}

/**
 * The same cached value with `update` applied to every post in it, and to the
 * `reposted_post` inside each repost (left `null` when the original is gone).
 *
 * Copies rather than edits: react-query hands observers the object it holds, and
 * a component that was given the same reference back re-renders into the old
 * numbers no matter what was written into it.
 */
export function mapCachedPosts(
  value: FeedCacheValue | undefined,
  update: (post: PostView) => PostView,
): FeedCacheValue | undefined {
  if (value === undefined || value === null) return value;
  const deep = (post: PostView): PostView => {
    const updated = update(post);
    return updated.reposted_post === null
      ? updated
      : { ...updated, reposted_post: update(updated.reposted_post) };
  };
  if ("pages" in value) {
    return {
      ...value,
      pages: value.pages.map((page) => ({
        ...page,
        items: page.items.map(deep),
      })),
    };
  }
  return {
    ...value,
    root: value.root === null ? null : deep(value.root),
    replies: value.replies.map(deep),
  };
}

/**
 * A post as it looks the instant the viewer likes or unlikes it.
 *
 * The count moves with the control, because those are the two things a reader
 * watches. It is floored at zero for the case the guess is wrong in the
 * unlikely direction — the server decides the real number, and `onSettled`
 * asks it.
 */
export function withLike(post: PostView, liked: boolean): PostView {
  return {
    ...post,
    liked_by_viewer: liked,
    like_count: Math.max(0, post.like_count + (liked ? 1 : -1)),
  };
}

/**
 * A post as it looks the instant the viewer reposts it or undoes the repost —
 * `withLike`'s twin, floored at zero for the same reason.
 */
export function withRepost(post: PostView, reposted: boolean): PostView {
  return {
    ...post,
    reposted_by_viewer: reposted,
    repost_count: Math.max(0, post.repost_count + (reposted ? 1 : -1)),
  };
}

/**
 * A public-media key joined to the configured base — the site origin in
 * production, not `/media`: keys already start with `media/`, and CloudFront
 * serves `/media/*` from the public-media bucket unchanged ([[0x04-media]]).
 *
 * The trims are what keep a trailing slash on the base, or a leading one on the
 * key, from producing a doubled separator that CloudFront answers 404 for.
 */
export function mediaUrl(key: string): string {
  return `${config.mediaBaseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}
