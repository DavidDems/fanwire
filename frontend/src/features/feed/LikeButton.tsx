import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/ui/Button";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { HeartIcon } from "../../components/ui/icons";
import styles from "./LikeButton.module.css";
import {
  FEED_KEY_ROOT,
  cacheHolds,
  mapCachedPosts,
  setLiked,
  withLike,
  type FeedCacheValue,
  type PostView,
} from "./api";

/**
 * Like / unlike, optimistically, with the count beside it.
 *
 * **What "optimistic" means here** is the same thing it means in
 * `features/profile/FollowButton.tsx`: the control *and* the number change
 * before the request returns, and both are put back if it fails. The two are in
 * one component precisely because they are one fact — a button that flipped
 * while the count beside it waited for the server would read as a bug even
 * though both are eventually right.
 *
 * **Where the snapshot lives, given the feed is paginated.** Nowhere near this
 * component. A post is not owned by one cache entry: it is in whichever feed
 * page it arrived on, and again in the replies of every thread expanded above
 * it, so `useState` here would move one copy of a post and leave the other
 * stale on the same screen. `onMutate` therefore patches *every* entry under
 * `FEED_KEY_ROOT` that holds this post, and keeps those entries — keys and all —
 * as the rollback. React-query hands the snapshot back to `onError` and
 * `onSettled` unchanged, so the same list is what gets restored and what gets
 * invalidated.
 *
 * **`onSettled` invalidates exact keys**, and only the keys that turned out to
 * hold the post. `invalidateQueries({ queryKey: ["feed"] })` is a prefix match:
 * liking one post would refetch the feed and every thread the reader had opened,
 * as collateral. The exact keys are known because `onMutate` already had to find
 * them in order to patch them.
 *
 * **An anonymous visitor sees the control and is sent to sign-in by it**, the
 * way `FollowButton` does and carrying `state.from` the way `routes/guards.tsx`
 * does. Reading the session to decide that is not the feed learning anything
 * about itself: the request that filled this page was the same one either way,
 * and what is rendered is identical — only what the click *does* differs.
 */

/** The entries `onMutate` patched, kept so `onError` can put them back verbatim. */
interface LikeSnapshot {
  patched: [QueryKey, FeedCacheValue | undefined][];
}

export interface LikeButtonProps {
  post: PostView;
}

export function LikeButton({ post }: LikeButtonProps) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const toggle = useMutation<void, Error, boolean, LikeSnapshot>({
    mutationFn: (next: boolean) => setLiked(post.id, next),

    onMutate: async (next: boolean): Promise<LikeSnapshot> => {
      // An in-flight read that lands after the patch would overwrite it with the
      // pre-like answer it was already carrying. Cancelling at the root covers
      // the feed and every open thread, which is exactly the set about to be
      // patched.
      await queryClient.cancelQueries({ queryKey: FEED_KEY_ROOT });

      const patched = queryClient
        .getQueriesData<FeedCacheValue>({ queryKey: FEED_KEY_ROOT })
        .filter(([, value]) => cacheHolds(value, post.id));

      queryClient.setQueriesData<FeedCacheValue>(
        { queryKey: FEED_KEY_ROOT },
        (value) =>
          mapCachedPosts(value, (candidate) =>
            candidate.id === post.id ? withLike(candidate, next) : candidate,
          ),
      );

      return { patched };
    },

    onError: (_error, _next, snapshot) => {
      for (const [key, value] of snapshot?.patched ?? []) {
        queryClient.setQueryData(key, value);
      }
      // Never the failure's own text: it may carry a URL or a status line the
      // reader cannot act on, and retrying is the one thing they can.
      setFailure("We could not save that just now. Please try again.");
    },

    onSettled: (_data, _error, _next, snapshot) => {
      // The server decides the count, not the guess above: somebody else may
      // have liked the same post while this request was in flight.
      for (const [key] of snapshot?.patched ?? []) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true });
      }
    },
  });

  function handleClick(): void {
    if (status !== "authenticated") {
      // `from` is what `SignInPage` reads to send them back afterwards. No
      // unauthenticated write is ever fired: a 401 here is a failure a
      // deliberately public page would then have to explain away.
      navigate("/sign-in", { state: { from: location } });
      return;
    }
    setFailure(null);
    toggle.mutate(!post.liked_by_viewer);
  }

  return (
    <>
      {/*
       * `data-active` is for CSS only (it fills the heart): the label carries
       * the state, so no `aria-pressed` (`components.md` §2).
       */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-active={post.liked_by_viewer ? "" : undefined}
        onClick={handleClick}
        disabled={toggle.isPending}
      >
        <HeartIcon />
        {post.liked_by_viewer ? "Unlike" : "Like"}
      </Button>
      {/*
       * The count is its own text beside the control rather than part of its
       * label: a button named "Like (4)" changes its accessible name every time
       * anybody anywhere likes the post, which a screen reader announces as a
       * different button appearing. One template string, so it is one text
       * node a reader (and a test) sees whole.
       */}
      <span className={styles.count}>{`${post.like_count} likes`}</span>
      {failure === null ? null : (
        <div className={styles.failure}>
          <InlineAlert>{failure}</InlineAlert>
        </div>
      )}
    </>
  );
}
