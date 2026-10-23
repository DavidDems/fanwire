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
 */
export function Skeleton({ variant, media = false }: SkeletonProps) {
  if (variant === "line") {
    return <div aria-hidden="true" className={styles.bar} />;
  }
  return (
    <div aria-hidden="true" className={styles.post}>
      <div className={styles.avatar} />
      <div className={styles.lines}>
        <div className={styles.bar} />
        <div className={`${styles.bar} ${styles.short}`} />
        {media ? <div className={styles.frame} /> : null}
      </div>
    </div>
  );
}
