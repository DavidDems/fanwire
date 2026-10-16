import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { Button, buttonClass } from "../../components/ui/Button";
import { InlineAlert } from "../../components/ui/InlineAlert";
import styles from "./PostAction.module.css";
import {
  FEED_KEY_ROOT,
  cacheHolds,
  mapCachedPosts,
  type FeedCacheValue,
  type PostView,
} from "./api";

/**
 * One control in a post's action row — like, reply or repost — and its count.
 *
 * **One shape for all three** (UI-009): an icon-only control named by its
 * `aria-label`, then its count as text right after it. The name is the action
 * and never changes ("Like", "Repost", "Reply"); the viewer's state is
 * `aria-pressed` on the two toggles, and a pressed toggle swaps to a filled (or
 * heavier) icon so the state is not carried by colour alone
 * (`accessibility.md`). A name that flipped to "Unlike" *and* a pressed state
 * would be the same fact announced twice, so the name holds still.
 *
 * **The count is outside the control**, never in its name: a button named
 * "Like (4)" changes its accessible name every time anybody anywhere likes the
 * post, which a screen reader announces as a different button appearing. One
 * template string (`counts.ts`), so it is one text node a reader sees whole.
 *
 * Reply is the same shape with `to` instead of a toggle: it is a link, because
 * what it does is go somewhere.
 */
export interface PostActionProps {
  /** The accessible name: the action, never the count or the state. */
  label: string;
  icon: ReactNode;
  /** The count beside the control, as `countText` writes it. */
  count: string;
  /** A link to here instead of a button (reply). */
  to?: string;
  /** A toggle's state, as `aria-pressed`; omitted for a link. */
  pressed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export function PostAction({
  label,
  icon,
  count,
  to,
  pressed,
  onClick,
  disabled,
}: PostActionProps) {
  return (
    <span className={styles.action}>
      {to === undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={styles.control}
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          disabled={disabled}
        >
          {icon}
        </Button>
      ) : (
        <Link
          className={`${buttonClass("ghost", "sm")} ${styles.control}`}
          to={to}
          aria-label={label}
        >
          {icon}
        </Link>
      )}
      <span className={styles.count}>{count}</span>
    </span>
  );
}

/**
 * A toggle action — like or repost — applied optimistically to every cached
 * copy of the post. This is the feed's one optimistic pattern; like and repost
 * differ only in the request they send and the edit they make to a post.
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
 * page it arrived on, again in the replies of every thread expanded above it,
 * in search results, and inside every repost of it (`reposted_post`), so
 * `useState` here would move one copy of a post and leave the others stale on
 * the same screen. `onMutate` therefore patches *every* entry under
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
export interface TogglePostActionProps {
  /** The post the toggle acts on — for a plain repost, the original's id. */
  postId: number;
  label: string;
  pressed: boolean;
  count: string;
  icon: ReactNode;
  pressedIcon: ReactNode;
  /** The request: `setLiked` or `setReposted`. */
  send: (postId: number, next: boolean) => Promise<void>;
  /** The optimistic edit: `withLike` or `withRepost`. */
  apply: (post: PostView, next: boolean) => PostView;
}

/** The entries `onMutate` patched, kept so `onError` can put them back verbatim. */
interface ToggleSnapshot {
  patched: [QueryKey, FeedCacheValue | undefined][];
}

export function TogglePostAction({
  postId,
  label,
  pressed,
  count,
  icon,
  pressedIcon,
  send,
  apply,
}: TogglePostActionProps) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const toggle = useMutation<void, Error, boolean, ToggleSnapshot>({
    mutationFn: (next: boolean) => send(postId, next),

    onMutate: async (next: boolean): Promise<ToggleSnapshot> => {
      // An in-flight read that lands after the patch would overwrite it with the
      // pre-toggle answer it was already carrying. Cancelling at the root covers
      // the feed, every open thread and the search results, which is exactly the
      // set about to be patched.
      await queryClient.cancelQueries({ queryKey: FEED_KEY_ROOT });

      const patched = queryClient
        .getQueriesData<FeedCacheValue>({ queryKey: FEED_KEY_ROOT })
        .filter(([, value]) => cacheHolds(value, postId));

      queryClient.setQueriesData<FeedCacheValue>(
        { queryKey: FEED_KEY_ROOT },
        (value) =>
          mapCachedPosts(value, (candidate) =>
            candidate.id === postId ? apply(candidate, next) : candidate,
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
      // have liked or reposted the same post while this request was in flight.
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
    toggle.mutate(!pressed);
  }

  return (
    <>
      <PostAction
        label={label}
        icon={pressed ? pressedIcon : icon}
        count={count}
        pressed={pressed}
        onClick={handleClick}
        disabled={toggle.isPending}
      />
      {failure === null ? null : (
        <div className={styles.failure}>
          <InlineAlert>{failure}</InlineAlert>
        </div>
      )}
    </>
  );
}
