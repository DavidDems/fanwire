import { useEffect } from "react";

import { Skeleton } from "../../components/ui/Skeleton";
import { PostNode } from "./PostNode";
import type { PostView } from "./api";
import {
  CardImageContext,
  useCardReady,
  usePrepareWindow,
} from "./useCardReady";

export interface PreparedPostNodeProps {
  post: PostView;
  /**
   * Told whether this card is being prepared right now: in the window and
   * still a skeleton. What the feed's `aria-busy` is made of.
   */
  onPreparing?: (postId: number, preparing: boolean) => void;
}

/**
 * A post card that appears whole (`FRONTEND-015`): the shared `Skeleton` post
 * variant until `useCardReady` says the card is ready, then the whole
 * `PostNode` in one render. The one wrapper the feed, search results and the
 * thread modal render a post through, so no list re-implements the rule.
 *
 * The skeleton is what the prepare window watches: a card further down than
 * the window asks for none of its pictures. A card with media reserves the
 * picture's 4:3 frame in its skeleton, so the reveal moves nothing below it.
 * The swap is immediate (`components.md`: no shimmer, nothing to switch off for
 * reduced motion).
 */
export function PreparedPostNode({ post, onPreparing }: PreparedPostNodeProps) {
  const [windowRef, inWindow] = usePrepareWindow();
  const { ready, hasMedia, statusOf } = useCardReady(post, inWindow);
  const preparing = inWindow && !ready;

  useEffect(() => {
    onPreparing?.(post.id, preparing);
  }, [onPreparing, post.id, preparing]);

  if (!ready) {
    return (
      <div ref={windowRef}>
        <Skeleton variant="post" media={hasMedia} />
      </div>
    );
  }
  return (
    <CardImageContext.Provider value={statusOf}>
      <PostNode post={post} />
    </CardImageContext.Provider>
  );
}
