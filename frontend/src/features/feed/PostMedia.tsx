import { useContext, useState } from "react";

import styles from "./PostMedia.module.css";
import { mediaUrl, type MediaItemView } from "./api";
import { CardImageContext } from "./useCardReady";

/**
 * One processed image on a post, in its fixed 4:3 frame (`FRONTEND-015`).
 *
 * **A picture that cannot be shown keeps its frame.** An error, a missing
 * public key, or (inside `PreparedPostNode`) a picture that did not settle
 * within the card's bound is said as a neutral "Image unavailable" line in the
 * very box the picture would have filled. It used to leave nothing behind;
 * that was a layout shift for every card below it.
 *
 * Inside a prepared card the picture is drawn only once `useCardReady` has it
 * loaded, from the same URL, so it paints from the cache; until then (only a
 * revealed card whose picture changed) the frame is empty. A bare `PostNode`
 * has no readiness and renders the picture at once.
 *
 * The key rendered is `s3_key_public`, not `s3_key_thumbnail`: the thumbnail is
 * the composer's preview of an upload in progress, and the feed shows the
 * picture the post actually carries.
 */

export interface PostMediaProps {
  item: MediaItemView;
  /**
   * The author's username, used to name the picture.
   *
   * `MediaItemView` carries no caption or alt text — nothing in the media
   * pipeline collects one — so the only honest name available is whose post it
   * is on. An empty `alt` would take the image out of the accessibility tree
   * entirely, which is a different claim: that it carries no information.
   */
  author: string;
}

export function PostMedia({ item, author }: PostMediaProps) {
  const statusOf = useContext(CardImageContext);
  const [failed, setFailed] = useState(false);

  // `s3_key_public` is nullable in the schema: a row can reach the feed before
  // the pipeline has written its public object. There is nothing to point an
  // `<img>` at, and an element with an empty `src` re-requests the page itself —
  // so it is the same answer as a load that failed, for the same reason.
  const url = item.s3_key_public === null ? null : mediaUrl(item.s3_key_public);
  const status =
    url === null || failed ? "unavailable" : (statusOf?.(url) ?? "loaded");

  return (
    <div className={styles.frame}>
      {status === "unavailable" ? (
        <p className={styles.unavailable}>Image unavailable</p>
      ) : status === "pending" || url === null ? null : (
        <img
          className={styles.media}
          src={url}
          alt={`Image posted by ${author}`}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
