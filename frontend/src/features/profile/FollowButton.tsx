import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { components } from "../../api/schema";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/ui/Button";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { FOLLOWING_QUERY_KEY, setFollowing, viewedUserKey } from "./api";

/**
 * Follow / unfollow, optimistically.
 *
 * **What "optimistic" means here.** The button *and* the follower count change
 * before the request returns, and both are restored if it fails — those are the
 * two things a user sees change. It is done through react-query's mutation
 * lifecycle rather than a `useState` next to a `useEffect`, because the count
 * lives in the viewed profile's cache entry: local state beside it drifts out of
 * sync with that entry after the second interaction, and the server's answer
 * then loses to a stale guess.
 *
 * `onSettled` invalidates **exact** keys. `invalidateQueries({ queryKey:
 * ["users"] })` is a prefix match, and it would refetch every other profile the
 * session has looked at as collateral for following one person.
 *
 * **Anonymous visitors.** A public profile is a read path and stays readable
 * signed out ([[0x01-users]]), so the control still renders — but using it sends
 * the visitor to sign-in carrying where they were, the convention
 * `routes/guards.tsx` uses. It never fires an unauthenticated write: a 401 here
 * is a failure the page would then have to explain away.
 */

type PublicUserOut = components["schemas"]["PublicUserOut"];

/** The cache entries `onMutate` patched, kept so `onError` can put them back. */
interface FollowSnapshot {
  profile: PublicUserOut | undefined;
  following: number[] | undefined;
}

export interface FollowButtonProps {
  /** The user being viewed — never the signed-in one; this is not rendered there. */
  userId: number;
  /**
   * Whether the caller already follows them.
   *
   * The follow set is read by `ProfilePage`, alongside the profile itself,
   * rather than here: this control is the last thing on the page to mount, so
   * owning the query would start it only once the profile had arrived, and the
   * button would spend that round trip claiming "Follow" to somebody who
   * already follows them.
   */
  isFollowing: boolean;
}

export function FollowButton({ userId, isFollowing }: FollowButtonProps) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const toggle = useMutation<void, Error, boolean, FollowSnapshot>({
    mutationFn: (next: boolean) => setFollowing(userId, next),

    onMutate: async (next: boolean): Promise<FollowSnapshot> => {
      // An in-flight read that lands after the patch would overwrite it with the
      // pre-follow answer it was already carrying.
      await queryClient.cancelQueries({
        queryKey: viewedUserKey(userId),
        exact: true,
      });
      await queryClient.cancelQueries({
        queryKey: FOLLOWING_QUERY_KEY,
        exact: true,
      });

      const snapshot: FollowSnapshot = {
        profile: queryClient.getQueryData<PublicUserOut>(viewedUserKey(userId)),
        following: queryClient.getQueryData<number[]>(FOLLOWING_QUERY_KEY),
      };

      queryClient.setQueryData<PublicUserOut>(
        viewedUserKey(userId),
        (current) =>
          current === undefined
            ? current
            : // Following *them* changes how many followers they have, and nothing
              // about how many people they follow.
              {
                ...current,
                follower_count: current.follower_count + (next ? 1 : -1),
              },
      );
      queryClient.setQueryData<number[]>(FOLLOWING_QUERY_KEY, (current) => {
        const ids = current ?? [];
        if (!next) return ids.filter((id) => id !== userId);
        return ids.includes(userId) ? ids : [...ids, userId];
      });

      return snapshot;
    },

    onError: (_error, _next, snapshot) => {
      if (snapshot !== undefined) {
        if (snapshot.profile !== undefined) {
          queryClient.setQueryData(viewedUserKey(userId), snapshot.profile);
        }
        if (snapshot.following !== undefined) {
          queryClient.setQueryData(FOLLOWING_QUERY_KEY, snapshot.following);
        }
      }
      // The reason is never the failure's own text: it may carry a URL or a
      // header the user cannot act on, and this is the one thing they can.
      setFailure("We could not update who you follow. Please try again.");
    },

    onSettled: () => {
      // The server decides the counts, not the optimistic guess: somebody else
      // may have followed them while this request was in flight.
      void queryClient.invalidateQueries({
        queryKey: viewedUserKey(userId),
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: FOLLOWING_QUERY_KEY,
        exact: true,
      });
    },
  });

  function handleClick(): void {
    if (status !== "authenticated") {
      // `from` is what `SignInPage` reads to send them back afterwards.
      navigate("/sign-in", { state: { from: location } });
      return;
    }
    setFailure(null);
    toggle.mutate(!isFollowing);
  }

  return (
    <>
      {/* `data-active` is for CSS only: the label carries the state, so no `aria-pressed`. */}
      <Button
        type="button"
        variant={isFollowing ? "secondary" : "primary"}
        size="md"
        data-active={isFollowing ? "" : undefined}
        onClick={handleClick}
        disabled={toggle.isPending}
      >
        {isFollowing ? "Unfollow" : "Follow"}
      </Button>
      {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}
    </>
  );
}
