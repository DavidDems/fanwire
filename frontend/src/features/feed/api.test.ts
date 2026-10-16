/**
 * UI-009 criteria 3 and 4, at the helpers: `setReposted` is the repost twin of
 * `setLiked` (POST to repost, DELETE to undo, through the real generated client
 * against msw), `withRepost` is the twin of `withLike`, and the two cache
 * walkers reach the fourth place a post can be cached — the `reposted_post`
 * inside a repost's view — in both cached shapes (a run of feed pages, and one
 * thread). Without that, liking an original through its repost card would leave
 * the original's own card behind.
 */
import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  feedPage,
  repostStub,
  testPlainRepost,
  testPostView,
  testQuoteRepost,
  threadView,
  type FeedPageBody,
} from "../../test/feed";
import { server } from "../../test/server";
import {
  cacheHolds,
  mapCachedPosts,
  setReposted,
  withLike,
  withRepost,
  type FeedCacheValue,
  type PostView,
} from "./api";

const ORIGINAL = testPostView({
  id: 401,
  text: "Original take",
  like_count: 5,
});
const PLAIN = testPlainRepost(ORIGINAL, { id: 402 });
const QUOTE = testQuoteRepost(ORIGINAL, "Hot take on this", { id: 403 });
const OTHER = testPostView({ id: 404, text: "Unrelated" });

function pages(
  ...items: PostView[][]
): InfiniteData<FeedPageBody, number | null> {
  return {
    pages: items.map((page) => feedPage(page, null)),
    pageParams: items.map((_, index) => (index === 0 ? null : index)),
  };
}

function likeOriginal(post: PostView): PostView {
  return post.id === ORIGINAL.id ? withLike(post, true) : post;
}

describe("setReposted", () => {
  it("POSTs /posts/{id}/repost to repost", async () => {
    const repost = repostStub();
    server.use(...repost.handlers);

    await expect(setReposted(401, true)).resolves.toBeUndefined();
    expect(repost.calls).toEqual([{ method: "POST", postId: 401 }]);
  });

  it("resolves for a post the server says is already reposted (200)", async () => {
    const repost = repostStub();
    repost.answerExisting();
    server.use(...repost.handlers);

    await expect(setReposted(401, true)).resolves.toBeUndefined();
  });

  it("DELETEs /posts/{id}/repost to undo", async () => {
    const repost = repostStub();
    server.use(...repost.handlers);

    await expect(setReposted(401, false)).resolves.toBeUndefined();
    expect(repost.calls).toEqual([{ method: "DELETE", postId: 401 }]);
  });

  it("rejects when the repost fails", async () => {
    const repost = repostStub();
    repost.fail();
    server.use(...repost.handlers);

    await expect(setReposted(401, true)).rejects.toThrow();
  });

  it("rejects when the undo is refused with 409", async () => {
    const repost = repostStub();
    repost.fail(409);
    server.use(...repost.handlers);

    await expect(setReposted(401, false)).rejects.toThrow();
  });
});

describe("withRepost", () => {
  it("marks the post reposted and adds one to its count", () => {
    const next = withRepost(
      testPostView({ repost_count: 2, reposted_by_viewer: false }),
      true,
    );

    expect(next.reposted_by_viewer).toBe(true);
    expect(next.repost_count).toBe(3);
  });

  it("unmarks the post and takes one off its count", () => {
    const next = withRepost(
      testPostView({ repost_count: 2, reposted_by_viewer: true }),
      false,
    );

    expect(next.reposted_by_viewer).toBe(false);
    expect(next.repost_count).toBe(1);
  });

  it("never takes the count below zero", () => {
    const next = withRepost(
      testPostView({ repost_count: 0, reposted_by_viewer: true }),
      false,
    );

    expect(next.repost_count).toBe(0);
  });

  it("copies rather than edits the post it was given", () => {
    const post = testPostView({ repost_count: 2 });

    const next = withRepost(post, true);

    expect(next).not.toBe(post);
    expect(post.repost_count).toBe(2);
    expect(post.reposted_by_viewer).toBe(false);
    expect({ ...next, repost_count: 2, reposted_by_viewer: false }).toEqual(
      post,
    );
  });
});

describe("mapCachedPosts reaches the post inside a repost", () => {
  it("applies the update to reposted_post in feed pages", () => {
    const value = mapCachedPosts(
      pages([PLAIN, OTHER], [QUOTE]),
      likeOriginal,
    ) as InfiniteData<FeedPageBody, number | null>;

    const [plain, other] = value.pages[0].items;
    const [quote] = value.pages[1].items;
    expect(plain.reposted_post?.like_count).toBe(6);
    expect(plain.reposted_post?.liked_by_viewer).toBe(true);
    expect(quote.reposted_post?.like_count).toBe(6);
    // The reposts themselves are other posts and keep their own numbers.
    expect(plain.like_count).toBe(PLAIN.like_count);
    expect(quote.like_count).toBe(QUOTE.like_count);
    expect(other).toEqual(OTHER);
  });

  it("applies the update to reposted_post in a thread's root and replies", () => {
    const value = mapCachedPosts(
      threadView(QUOTE, [PLAIN, OTHER]),
      likeOriginal,
    ) as ReturnType<typeof threadView>;

    expect(value.root.reposted_post?.like_count).toBe(6);
    expect(value.replies[0].reposted_post?.like_count).toBe(6);
    expect(value.replies[1]).toEqual(OTHER);
  });

  it("still applies the update to the post itself", () => {
    const value = mapCachedPosts(
      pages([ORIGINAL, PLAIN]),
      likeOriginal,
    ) as InfiniteData<FeedPageBody, number | null>;

    const [original, plain] = value.pages[0].items;
    expect(original.like_count).toBe(6);
    expect(plain.reposted_post?.like_count).toBe(6);
  });

  it("leaves a repost whose original is unavailable alone", () => {
    const unavailable = testPlainRepost(null, { id: 405 });

    const value = mapCachedPosts(
      pages([unavailable]),
      likeOriginal,
    ) as InfiniteData<FeedPageBody, number | null>;

    expect(value.pages[0].items[0].reposted_post).toBeNull();
  });

  it("copies rather than edits the cached value", () => {
    const before = pages([PLAIN]);

    mapCachedPosts(before, likeOriginal);

    expect(before.pages[0].items[0].reposted_post?.like_count).toBe(5);
  });
});

describe("cacheHolds finds a post inside a repost", () => {
  it("in feed pages", () => {
    expect(cacheHolds(pages([OTHER], [PLAIN]), ORIGINAL.id)).toBe(true);
    expect(cacheHolds(pages([QUOTE]), ORIGINAL.id)).toBe(true);
    expect(cacheHolds(pages([OTHER]), ORIGINAL.id)).toBe(false);
  });

  it("in a thread's root and its replies", () => {
    expect(cacheHolds(threadView(PLAIN, []), ORIGINAL.id)).toBe(true);
    expect(cacheHolds(threadView(OTHER, [QUOTE]), ORIGINAL.id)).toBe(true);
    expect(cacheHolds(threadView(OTHER, []), ORIGINAL.id)).toBe(false);
  });

  it("still finds the repost's own id", () => {
    const value: FeedCacheValue = pages([PLAIN]);

    expect(cacheHolds(value, PLAIN.id)).toBe(true);
    expect(cacheHolds(undefined, PLAIN.id)).toBe(false);
  });
});
