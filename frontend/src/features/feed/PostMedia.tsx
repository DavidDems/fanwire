import { useState } from "react";

import styles from "./PostMedia.module.css";
import { mediaUrl, type MediaItemView } from "./api";

/**
 * One processed image on a post.
 *
 * **A picture that fails to load leaves nothing behind.** Not a broken-image
 * icon, not a bordered box of alt text — the element is taken out of the tree.
 * A feed is dozens of these at once, and a column of broken frames is worse to
 * read than the same column with no pictures in it; the post's own text is what
 * survives, and it is still there.
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
  const [failed, setFailed] = useState(false);

  // `s3_key_public` is nullable in the schema: a row can reach the feed before
  // the pipeline has written its public object. There is nothing to point an
  // `<img>` at, and an element with an empty `src` re-requests the page itself —
  // so it is the same answer as a load that failed, for the same reason.
  if (failed || item.s3_key_public === null) return null;

  return (
    <img
      className={styles.media}
      src={mediaUrl(item.s3_key_public)}
      alt={`Image posted by ${author}`}
      onError={() => setFailed(true)}
    />
  );
}
