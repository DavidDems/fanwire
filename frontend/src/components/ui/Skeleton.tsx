import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  variant: "post" | "line";
  /**
   * The post variant only: the card it stands in for has a picture, so the
   * skeleton reserves the picture's 4:3 frame and the reveal moves nothing
   * (`FRONTEND-015`).
   */
  media?: boolean;
}

/**
 * A static placeholder while something loads. `aria-hidden`: the `StatusLine`
 * beside it is what is announced. No shimmer (`components.md` §2).
 *
 * The `post` variant is laid out as a typical post card (`features/feed`'s
 * `PostNode`): the card's box, an author row as tall as the avatar, one line of
 * text, the picture's frame across the card's full inner width when `media`,
 * and the action row, which wraps on a phone exactly where the card's does. A
 * card revealed in its place is the same height, so nothing below it moves.
 */
export function Skeleton({ variant, media = false }: SkeletonProps) {
  if (variant === "line") {
    return <div aria-hidden="true" className={styles.bar} />;
  }
  return (
    <div aria-hidden="true" className={styles.post}>
      <div className={styles.header}>
        <div className={styles.avatar} />
        <div className={`${styles.bar} ${styles.author}`} />
      </div>
      <div className={styles.text}>
        <div className={styles.bar} />
      </div>
      {media ? <div className={styles.frame} /> : null}
      <div className={styles.footer}>
        <PostActionBlock count={styles.likes} />
        <PostActionBlock count={styles.replies} />
        <PostActionBlock count={styles.reposts} />
      </div>
    </div>
  );
}

/** One action's place in the row: the square control, then its count. */
function PostActionBlock({ count }: { count: string | undefined }) {
  return (
    <div className={styles.action}>
      <div className={styles.control} />
      <div className={`${styles.bar} ${count}`} />
    </div>
  );
}
